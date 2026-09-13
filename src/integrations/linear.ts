/**
 * Linear integration — reads the roadmap and turns it into tracking suggestions.
 *
 * Two entry points, both called from outside this file:
 *   - `runLinearScan()`   weekly cron (src/worker/index.ts) + manual trigger
 *   - `createIssue(s)`    the Suggestions page "push to Linear" action
 *
 * Neither ever throws. A weekly cron job must not be able to take the worker
 * down, and a failed push must degrade to a disabled button, not a 500.
 *
 * Linear auth quirk: the personal API key goes in `Authorization` RAW — no
 * `Bearer ` prefix. With the prefix every request 401s.
 */
import Anthropic from '@anthropic-ai/sdk';
import { PROJECT, REASONING_MODEL } from '../lib/config';
import { all, run } from '../lib/db';
import type { Suggestion, SuggestionKind } from '../lib/types';
import { log, logError } from '../worker/log';

export const LINEAR_API_URL = 'https://api.linear.app/graphql';

/** Linear is slow under load; a cron job should give up rather than hang. */
const LINEAR_TIMEOUT_MS = 20_000;

/** Hard ceiling from BUILD_PLAN §8 C2.3 — at most 5 suggestions per scan. */
const MAX_SUGGESTIONS = 5;

export function isLinearConfigured(): boolean {
  return Boolean(process.env.LINEAR_API_KEY);
}

/* ------------------------------------------------------------------ */
/* GraphQL                                                             */
/* ------------------------------------------------------------------ */

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

/**
 * POST a GraphQL document and return `data`, or throw with a readable message.
 * Callers are all inside try/catch — this is the only place that throws.
 */
async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error('LINEAR_API_KEY not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINEAR_TIMEOUT_MS);
  try {
    const response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Raw key — Linear rejects the "Bearer " prefix for personal API keys.
        Authorization: key,
      },
      body: JSON.stringify(variables ? { query, variables } : { query }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Linear HTTP ${response.status} ${body.slice(0, 300)}`);
    }

    const payload = (await response.json()) as GraphQLResponse<T>;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((e) => e.message ?? 'unknown').join('; '));
    }
    if (!payload.data) throw new Error('Linear returned no data');
    return payload.data;
  } finally {
    clearTimeout(timer);
  }
}

export interface LinearProject {
  id: string;
  name: string;
  description: string | null;
  state: string | null;
  url: string | null;
}

const PROJECTS_QUERY = `
  query GeoRoadmapScan {
    projects(first: 50) {
      nodes {
        id
        name
        description
        state
        url
      }
    }
  }
`;

/** Read-only fetch of the workspace roadmap. Empty array is a valid result. */
export async function fetchProjects(): Promise<LinearProject[]> {
  const data = await graphql<{ projects: { nodes: LinearProject[] } }>(PROJECTS_QUERY);
  return data.projects?.nodes ?? [];
}

const FIRST_TEAM_QUERY = `
  query GeoFirstTeam {
    teams(first: 1) {
      nodes {
        id
        name
      }
    }
  }
`;

/** The workspace's first team — issues must belong to one. */
async function fetchFirstTeam(): Promise<{ id: string; name: string } | null> {
  const data = await graphql<{ teams: { nodes: Array<{ id: string; name: string }> } }>(
    FIRST_TEAM_QUERY
  );
  return data.teams?.nodes?.[0] ?? null;
}

const ISSUE_CREATE_MUTATION = `
  mutation GeoIssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        url
      }
    }
  }
`;

/* ------------------------------------------------------------------ */
/* Suggestion generation                                               */
/* ------------------------------------------------------------------ */

interface RawSuggestion {
  kind: string;
  text: string;
  project?: string;
  rationale: string;
}

/**
 * One forced tool call is the reliable way to get JSON out of the SDK — a
 * "reply with JSON only" prompt still fences or prefaces the block sometimes.
 */
const SUGGESTION_TOOL: Anthropic.Tool = {
  name: 'record_suggestions',
  description:
    'Record the tracking suggestions derived from the Linear roadmap. Call this exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        // No `maxItems` — strict tool schemas reject it. The cap is enforced by
        // the prompt, this description, and a hard slice() on the result.
        description: `At most ${MAX_SUGGESTIONS} suggestions, highest value first.`,
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['query', 'competitor'],
              description:
                "'query' for a new natural-language prompt to track; 'competitor' for a brand to start tracking.",
            },
            text: {
              type: 'string',
              description:
                'The query text to track (phrased as a real user would ask an AI assistant), or the competitor brand name.',
            },
            project: {
              type: 'string',
              description:
                'The exact name of the Linear project this came from, copied verbatim from the list.',
            },
            rationale: {
              type: 'string',
              description:
                'One sentence explaining why that project makes this worth tracking. Do not restate the project name; it is captured separately.',
            },
          },
          required: ['kind', 'text', 'project', 'rationale'],
          additionalProperties: false,
        },
      },
    },
    required: ['suggestions'],
    additionalProperties: false,
  },
  strict: true,
};

function buildScanPrompt(
  projects: LinearProject[],
  queries: string[],
  competitors: string[]
): string {
  const projectLines = projects
    .map((p) => {
      const state = p.state ? ` [${p.state}]` : '';
      const description = p.description?.trim() ? ` — ${p.description.trim()}` : '';
      return `- ${p.name}${state}${description}`;
    })
    .join('\n');

  return [
    `COMPANY CONTEXT (${PROJECT.name}, ${PROJECT.domain}):`,
    PROJECT.context,
    '',
    'WE CURRENTLY TRACK THESE QUERIES:',
    queries.length ? queries.map((q) => `- ${q}`).join('\n') : '(none yet)',
    '',
    'WE CURRENTLY TRACK THESE COMPETITOR BRANDS:',
    competitors.length ? competitors.map((c) => `- ${c}`).join('\n') : '(none yet)',
    '',
    'THE TEAM’S LINEAR ROADMAP (projects and descriptions):',
    projectLines,
    '',
    `The roadmap says where ${PROJECT.name} is heading. Where the roadmap moves the product into` +
      ' territory our tracked queries and competitors do not yet cover, propose what to start' +
      ' tracking so we can see how AI assistants answer buyers in that new territory.',
    '',
    'Rules:',
    `- At most ${MAX_SUGGESTIONS} suggestions. Fewer is fine; quality over quantity.`,
    '- Do NOT repeat anything already in the tracked lists above, or a near-paraphrase of it.',
    '- A "query" must read like a real question a buyer would type into an AI assistant.',
    '- A "competitor" must be a real company or product that would plausibly show up in answers' +
      ' about the roadmap area, and that we do not already track.',
    '- Every rationale must name the Linear project that motivated it.',
    '',
    'Call record_suggestions exactly once with your answer.',
  ].join('\n');
}

/** Whitespace/case-insensitive key used for duplicate detection. */
function dedupeKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function coerceKind(kind: string): SuggestionKind | null {
  const normalized = kind.trim().toLowerCase();
  if (normalized === 'query' || normalized === 'competitor') return normalized;
  return null;
}

/**
 * Ask the reasoning model for suggestions. Returns [] rather than throwing so
 * the caller's error path stays about Linear, not about the model.
 */
async function generateSuggestions(
  projects: LinearProject[],
  queries: string[],
  competitors: string[]
): Promise<RawSuggestion[]> {
  const client = new Anthropic();

  const message = await client.messages.create({
    model: REASONING_MODEL,
    max_tokens: 2000,
    system:
      'You are a GEO (generative engine optimization) analyst. You read a product roadmap and' +
      ' decide which new AI-assistant queries and which new competitor brands the team should' +
      ' start tracking. You answer only by calling the provided tool.',
    tools: [SUGGESTION_TOOL],
    // Forcing the tool is what makes the output reliably structured.
    tool_choice: { type: 'tool', name: SUGGESTION_TOOL.name },
    messages: [{ role: 'user', content: buildScanPrompt(projects, queries, competitors) }],
  });

  const block = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUGGESTION_TOOL.name
  );
  if (!block) {
    log('linear', `model returned no tool_use block (stop_reason ${message.stop_reason})`);
    return [];
  }

  const input = block.input as { suggestions?: unknown };
  if (!Array.isArray(input?.suggestions)) {
    log('linear', 'model tool input had no suggestions array');
    return [];
  }

  return input.suggestions.filter(
    (s): s is RawSuggestion =>
      Boolean(s) &&
      typeof s === 'object' &&
      typeof (s as RawSuggestion).kind === 'string' &&
      typeof (s as RawSuggestion).text === 'string' &&
      typeof (s as RawSuggestion).rationale === 'string'
  );
}

/* ------------------------------------------------------------------ */
/* Exported entry points                                               */
/* ------------------------------------------------------------------ */

/**
 * Scan the roadmap and insert suggestions. Returns how many NEW rows landed.
 *
 * Duplicates are skipped case-insensitively on `text` against everything
 * already in `suggestions` (any source, any status) and against earlier rows in
 * the same batch — re-running the weekly scan must not pile up the same rows.
 */
export async function runLinearScan(): Promise<number> {
  if (!isLinearConfigured()) {
    log('linear', 'LINEAR_API_KEY not set — scan skipped');
    return 0;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    log('linear', 'ANTHROPIC_API_KEY not set — scan skipped');
    return 0;
  }

  try {
    const projects = await fetchProjects();
    if (projects.length === 0) {
      log('linear', 'no projects in the workspace — nothing to scan');
      return 0;
    }

    const queries = all<{ text: string }>(
      `SELECT text FROM queries WHERE active = 1 ORDER BY id`
    ).map((r) => r.text);
    const competitors = all<{ name: string }>(
      `SELECT name FROM brands WHERE is_self = 0 ORDER BY id`
    ).map((r) => r.name);

    log(
      'linear',
      `scanning ${projects.length} project(s) against ${queries.length} query/queries and ` +
        `${competitors.length} competitor(s)`
    );

    const suggestions = await generateSuggestions(projects, queries, competitors);
    if (suggestions.length === 0) {
      log('linear', 'model proposed nothing — 0 suggestions inserted');
      return 0;
    }

    const seen = new Set(
      all<{ text: string }>(`SELECT text FROM suggestions`).map((r) => dedupeKey(r.text))
    );

    let inserted = 0;
    let skipped = 0;
    for (const candidate of suggestions.slice(0, MAX_SUGGESTIONS)) {
      const kind = coerceKind(candidate.kind);
      const text = candidate.text.trim();
      /**
       * Compose the stored rationale rather than trusting the model to format it.
       *
       * The Suggestions page parses "Linear project: <name> — <why>" to show which
       * project a suggestion came from. Asking the model to merely "name the
       * project" produced prose that never matched, so the project chip stayed
       * empty on every row. The project is now its own field and the prefix is
       * built here.
       */
      const why = candidate.rationale.trim();
      const project = candidate.project?.trim();
      const rationale = project ? `Linear project: ${project} — ${why}` : why;
      if (!kind || !text || !why) {
        skipped += 1;
        continue;
      }

      const key = dedupeKey(text);
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);

      run(
        `INSERT INTO suggestions (kind, text, rationale, source, status)
         VALUES (?, ?, ?, 'linear', 'pending')`,
        [kind, text, rationale]
      );
      inserted += 1;
    }

    log(
      'linear',
      `scan complete — ${inserted} new suggestion(s) inserted, ${skipped} skipped as duplicate/invalid`
    );
    return inserted;
  } catch (error) {
    logError('linear', 'scan failed', error);
    return 0;
  }
}

/**
 * Push an approved suggestion into Linear as an issue titled "GEO: <text>",
 * with the rationale in the body, on the workspace's first team.
 *
 * On success the new issue id is persisted to `suggestions.linear_issue_id` and
 * returned. Any failure logs and returns null.
 */
export async function createIssue(suggestion: Suggestion): Promise<string | null> {
  if (!isLinearConfigured()) {
    log('linear', 'LINEAR_API_KEY not set — issue not created');
    return null;
  }

  try {
    const team = await fetchFirstTeam();
    if (!team) {
      logError('linear', `no team in the workspace — issue not created for #${suggestion.id}`);
      return null;
    }

    const description = [
      suggestion.rationale,
      '',
      `**Kind:** ${suggestion.kind}`,
      `**Source:** ${suggestion.source}`,
      '',
      `_Raised automatically by the ${PROJECT.name} GEO visibility tracker._`,
    ].join('\n');

    const data = await graphql<{
      issueCreate: {
        success: boolean;
        issue: { id: string; identifier: string | null; url: string | null } | null;
      };
    }>(ISSUE_CREATE_MUTATION, {
      input: {
        teamId: team.id,
        title: `GEO: ${suggestion.text}`,
        description,
      },
    });

    const issue = data.issueCreate?.issue;
    if (!data.issueCreate?.success || !issue?.id) {
      logError('linear', `issueCreate returned no issue for suggestion #${suggestion.id}`);
      return null;
    }

    // Store the human identifier ("GEO-12") when Linear gives us one, falling back
    // to the UUID. This column is rendered on the Suggestions page and quoted in
    // Slack, and a bare UUID there is unreadable — the identifier is also what a
    // person types to find the issue in Linear.
    const reference = issue.identifier ?? issue.id;
    run(`UPDATE suggestions SET linear_issue_id = ? WHERE id = ?`, [reference, suggestion.id]);
    log('linear', `suggestion #${suggestion.id} → issue ${reference} on team ${team.name}`);
    return reference;
  } catch (error) {
    logError('linear', `issue creation failed for suggestion #${suggestion.id}`, error);
    return null;
  }
}

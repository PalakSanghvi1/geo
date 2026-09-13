/**
 * Seed the demo Linear workspace with Lemma's fake roadmap (BUILD_PLAN section 8,
 * Phase C2 item 2).
 *
 *   npm run seed-linear
 *
 * The weekly Linear scan reads these project names + descriptions and feeds them to
 * an LLM, so the wording here is the wording in the plan — verbatim, do not reword.
 *
 * Idempotent: existing projects are listed first and any name that already exists is
 * skipped, so re-running after a partial failure tops up the workspace instead of
 * creating duplicates.
 *
 * Auth note: Linear personal API keys go in the `Authorization` header RAW — no
 * `Bearer ` prefix. With the prefix every request 400s on authentication.
 */
import '../src/lib/env';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

/** Names and descriptions are copied verbatim from BUILD_PLAN section 8, Phase C2. */
const PROJECTS: Array<{ name: string; description: string }> = [
  {
    name: 'Voice agent tracing support',
    description:
      'Extend tracing SDK to capture voice agent sessions: STT/TTS spans, latency, interruption handling.',
  },
  {
    name: 'Self-serve onboarding',
    description:
      'PLG motion: signup without sales call, first-trace-in-10-minutes flow, starter tier pricing.',
  },
  {
    name: 'SOC 2 Type II automation',
    description:
      'Continuous compliance evidence collection; enterprise security questionnaire portal.',
  },
  {
    name: 'Computer-use agent monitoring',
    description:
      'Trace and replay browser/desktop automation agents; screenshot diffing on failures.',
  },
  {
    name: 'Eval marketplace',
    description: 'Community-contributed eval templates for common agent failure modes.',
  },
  {
    name: 'n8n and Zapier integration',
    description: 'Let no-code builders pipe Lemma alerts into their automation workflows.',
  },
];

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
};

/** Thrown for anything the API tells us is wrong — caught in main() and printed plainly. */
class LinearError extends Error {}

/**
 * One GraphQL round trip. Linear returns its errors in the body with a 400, so the
 * body is parsed regardless of HTTP status and the real message is surfaced.
 */
async function linear<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        // Raw key, NOT `Bearer <key>` — Linear personal API keys are a quirk here.
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new LinearError(`could not reach ${LINEAR_API_URL}: ${String(e)}`);
  }

  const text = await res.text();
  let json: GraphQLResponse<T>;
  try {
    json = JSON.parse(text) as GraphQLResponse<T>;
  } catch {
    throw new LinearError(`HTTP ${res.status}, non-JSON response: ${text.slice(0, 300)}`);
  }

  if (json.errors?.length) {
    const detail = json.errors
      .map((e) => {
        const code = e.extensions?.code;
        return code ? `${e.message ?? 'unknown error'} [${code}]` : (e.message ?? 'unknown error');
      })
      .join('; ');
    throw new LinearError(`Linear API error (HTTP ${res.status}): ${detail}`);
  }
  if (!res.ok) {
    throw new LinearError(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!json.data) {
    throw new LinearError(`HTTP ${res.status}: response had no data: ${text.slice(0, 300)}`);
  }
  return json.data;
}

type Team = { id: string; key: string; name: string };

async function resolveTeam(apiKey: string): Promise<Team> {
  const data = await linear<{ teams: { nodes: Team[] } }>(
    apiKey,
    `query SeedTeams {
      teams(first: 10) {
        nodes { id key name }
      }
    }`
  );
  const team = data.teams.nodes[0];
  if (!team) {
    throw new LinearError(
      'this Linear workspace has no teams — create one (the plan assumes a single team with key GEO) and re-run'
    );
  }
  return team;
}

/** Every project name already in the workspace, paginated so nothing is missed. */
async function fetchExistingProjectNames(apiKey: string): Promise<Set<string>> {
  const names = new Set<string>();
  let cursor: string | null = null;

  do {
    const data: {
      projects: {
        nodes: Array<{ id: string; name: string }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await linear(
      apiKey,
      `query SeedExistingProjects($after: String) {
        projects(first: 100, after: $after) {
          nodes { id name }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after: cursor }
    );
    for (const node of data.projects.nodes) names.add(normalize(node.name));
    cursor = data.projects.pageInfo.hasNextPage ? data.projects.pageInfo.endCursor : null;
  } while (cursor);

  return names;
}

/** Match on trimmed, case-folded names so a hand-created near-duplicate still counts. */
function normalize(name: string): string {
  return name.trim().toLowerCase();
}

async function createProject(
  apiKey: string,
  teamId: string,
  project: { name: string; description: string }
): Promise<{ id: string; name: string; url: string }> {
  const data = await linear<{
    projectCreate: { success: boolean; project: { id: string; name: string; url: string } | null };
  }>(
    apiKey,
    `mutation SeedProjectCreate($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        success
        project { id name url }
      }
    }`,
    {
      input: {
        name: project.name,
        description: project.description,
        teamIds: [teamId],
      },
    }
  );

  const { success, project: created } = data.projectCreate;
  if (!success || !created) {
    throw new LinearError(`projectCreate returned success=${success} for "${project.name}"`);
  }
  return created;
}

async function main() {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new LinearError(
      'LINEAR_API_KEY is not set. Add it to .env (Linear → Settings → Security & access → Personal API keys).'
    );
  }

  const team = await resolveTeam(apiKey);
  console.log(`seed-linear: team ${team.key} — ${team.name}`);

  const existing = await fetchExistingProjectNames(apiKey);
  console.log(`seed-linear: ${existing.size} existing project(s) in workspace\n`);

  let created = 0;
  let skipped = 0;

  for (const project of PROJECTS) {
    if (existing.has(normalize(project.name))) {
      skipped++;
      console.log(`  skipped  ${project.name}  (already exists)`);
      continue;
    }
    const result = await createProject(apiKey, team.id, project);
    existing.add(normalize(result.name));
    created++;
    console.log(`  created  ${result.name}  ${result.url}`);
  }

  console.log(
    `\nseed-linear: ${created} created, ${skipped} skipped, ${PROJECTS.length} total. Re-running is safe.`
  );
}

main().catch((e: unknown) => {
  const message = e instanceof LinearError ? e.message : e instanceof Error ? e.stack : String(e);
  console.error(`seed-linear failed: ${message}`);
  process.exit(1);
});

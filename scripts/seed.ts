/**
 * Seed brands, base queries, and AI-generated phrasing variations.
 *
 *   npm run seed              # idempotent: safe to re-run
 *   npm run seed -- --revariate   # regenerate variations for queries that have none
 *
 * Variations are generated ONCE and then frozen. Day-over-day trends are only
 * meaningful if the questions stay identical, so regenerating them mid-project would
 * silently break every comparison on the dashboard.
 */
import '../src/lib/env';
import Anthropic from '@anthropic-ai/sdk';
import { getDb, all, get, run as exec } from '../src/lib/db';
import {
  EXTRACTION_MODEL,
  PROJECT,
  SEED_BRANDS,
  SEED_QUERIES,
  VARIATIONS_PER_QUERY,
} from '../src/lib/config';

const client = new Anthropic({ maxRetries: 2 });

const VARIATION_TOOL: Anthropic.Tool = {
  name: 'record_variations',
  description: 'Record alternative phrasings of a question.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      variations: {
        type: 'array',
        description: 'Alternative phrasings, same intent, different wording.',
        items: { type: 'string' },
      },
    },
    required: ['variations'],
  },
};

async function generateVariations(text: string, n: number): Promise<string[]> {
  const response = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 700,
    system:
      'You rewrite questions the way different real people would type them into an AI assistant. ' +
      'Keep the intent and the subject identical. Vary wording, length and register — one may be ' +
      'terse, one more conversational. Never add a brand name that is not already in the question. ' +
      'Never answer the question. Call record_variations exactly once.',
    tools: [VARIATION_TOOL],
    tool_choice: { type: 'tool', name: 'record_variations' },
    messages: [{ role: 'user', content: `Context: ${PROJECT.context}\n\nQuestion: "${text}"\n\nGive exactly ${n} alternative phrasings.` }],
  });

  const call = response.content.find((b) => b.type === 'tool_use');
  if (!call || call.type !== 'tool_use') return [];
  const raw = call.input as { variations?: unknown };
  return (Array.isArray(raw.variations) ? raw.variations : [])
    .map((v) => String(v).trim())
    .filter((v) => v.length > 8 && v.toLowerCase() !== text.toLowerCase())
    .slice(0, n);
}

async function main() {
  const db = getDb();

  // --- brands -------------------------------------------------------------
  let brandsAdded = 0;
  for (const b of SEED_BRANDS) {
    const existing = get<{ id: number }>(`SELECT id FROM brands WHERE name = ?`, [b.name]);
    if (existing) {
      // Keep aliases current without disturbing ids that mentions point at.
      exec(`UPDATE brands SET is_self = ?, aliases = ? WHERE id = ?`, [
        b.isSelf ? 1 : 0,
        JSON.stringify(b.aliases ?? []),
        existing.id,
      ]);
      continue;
    }
    exec(`INSERT INTO brands (name, is_self, aliases) VALUES (?, ?, ?)`, [
      b.name,
      b.isSelf ? 1 : 0,
      JSON.stringify(b.aliases ?? []),
    ]);
    brandsAdded++;
  }
  console.log(`brands: ${brandsAdded} added, ${SEED_BRANDS.length - brandsAdded} already present`);

  // --- base queries -------------------------------------------------------
  let baseAdded = 0;
  for (const q of SEED_QUERIES) {
    if (get<{ id: number }>(`SELECT id FROM queries WHERE text = ?`, [q.text])) continue;
    exec(`INSERT INTO queries (text, parent_id, tag, active) VALUES (?, NULL, ?, 1)`, [q.text, q.tag]);
    baseAdded++;
  }
  console.log(`base queries: ${baseAdded} added, ${SEED_QUERIES.length - baseAdded} already present`);

  // --- variations ---------------------------------------------------------
  const bases = all<{ id: number; text: string; tag: string | null }>(
    `SELECT id, text, tag FROM queries WHERE parent_id IS NULL ORDER BY id`
  );

  const needing = bases.filter((b) => {
    const row = get<{ n: number }>(`SELECT COUNT(*) AS n FROM queries WHERE parent_id = ?`, [b.id]);
    return (row?.n ?? 0) < VARIATIONS_PER_QUERY;
  });

  if (needing.length === 0) {
    console.log('variations: already complete, nothing regenerated');
  } else {
    console.log(`variations: generating for ${needing.length} base queries…`);
    let added = 0;
    // Modest concurrency — this is a one-time setup step, not a hot path.
    const lanes = Array.from({ length: Math.min(5, needing.length) }, async function lane() {
      for (;;) {
        const base = needing.shift();
        if (!base) return;
        try {
          const variations = await generateVariations(base.text, VARIATIONS_PER_QUERY);
          const insert = db.prepare(
            `INSERT INTO queries (text, parent_id, tag, active) VALUES (?, ?, ?, 1)`
          );
          for (const v of variations) {
            if (get<{ id: number }>(`SELECT id FROM queries WHERE text = ?`, [v])) continue;
            insert.run(v, base.id, base.tag);
            added++;
          }
        } catch (err) {
          console.error(
            `  ! variation generation failed for query ${base.id}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    });
    await Promise.all(lanes);
    console.log(`variations: ${added} added`);
  }

  const totals = get<{ brands: number; base: number; vars: number }>(
    `SELECT (SELECT COUNT(*) FROM brands) AS brands,
            (SELECT COUNT(*) FROM queries WHERE parent_id IS NULL) AS base,
            (SELECT COUNT(*) FROM queries WHERE parent_id IS NOT NULL) AS vars`
  );
  const prompts = (totals?.base ?? 0) + (totals?.vars ?? 0);
  console.log(
    `\nseed: ${totals?.brands} brands, ${prompts} tracked prompts ` +
      `(${totals?.base} base + ${totals?.vars} variations) → ${prompts * 3} answers per run.`
  );

  console.log('\n--- prompts (sanity check) ---');
  for (const q of all<{ id: number; text: string; parent_id: number | null; tag: string | null }>(
    `SELECT id, text, parent_id, tag FROM queries ORDER BY COALESCE(parent_id, id), parent_id IS NOT NULL, id`
  )) {
    console.log(`${q.parent_id ? '  ↳' : '•'} [${q.tag ?? '-'}] ${q.text}`);
  }
}

main();

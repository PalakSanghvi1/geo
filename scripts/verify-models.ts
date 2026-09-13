/**
 * Verify the model ids in src/lib/config.ts against each provider's live model list.
 *
 *   npm run verify-models
 *
 * Hits the REST list endpoints directly rather than going through three SDKs, so
 * this keeps working when an SDK's surface changes. Prints, per provider:
 *   - whether the key authenticates at all
 *   - whether our `primary` and `fallback` ids exist
 *   - the closest available candidates, so a wrong guess is easy to correct
 */
import '../src/lib/env';
import { ANSWER_MODELS, EXTRACTION_MODEL, REASONING_MODEL } from '../src/lib/config';

type Listing = { ok: true; ids: string[] } | { ok: false; error: string };

async function listAnthropic(key: string): Promise<Listing> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${(await res.text()).slice(0, 200)}` };
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    return { ok: true, ids: (json.data ?? []).map((m) => m.id) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function listOpenAI(key: string): Promise<Listing> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${(await res.text()).slice(0, 200)}` };
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    return { ok: true, ids: (json.data ?? []).map((m) => m.id) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function listGemini(key: string): Promise<Listing> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${key}`
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${(await res.text()).slice(0, 200)}` };
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    // Names come back as "models/gemini-2.5-pro" — strip the prefix.
    return { ok: true, ids: (json.models ?? []).map((m) => m.name.replace(/^models\//, '')) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * A live one-token generation call. This is the test that actually matters: a key can
 * be blocked from ListModels yet still generate, and vice versa.
 */
async function probeGemini(key: string, model: string): Promise<string> {
  for (const version of ['v1beta', 'v1']) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the word OK.' }] }] }),
        }
      );
      if (res.ok) return `OK via ${version}`;
      const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 140);
      if (version === 'v1') return `HTTP ${res.status} — ${body}`;
    } catch (e) {
      if (version === 'v1') return String(e);
    }
  }
  return 'unknown';
}

/** Crude similarity: how many of the query's tokens appear in the candidate. */
function score(query: string, candidate: string): number {
  const tokens = query.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  const c = candidate.toLowerCase();
  return tokens.reduce((n, t) => n + (c.includes(t) ? 1 : 0), 0);
}

function candidates(query: string, ids: string[], limit = 6): string[] {
  return ids
    .map((id) => ({ id, s: score(query, id) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.id.length - b.id.length)
    .slice(0, limit)
    .map((x) => x.id);
}

async function main() {
  const keys = {
    anthropic: process.env.ANTHROPIC_API_KEY ?? '',
    openai: process.env.OPENAI_API_KEY ?? '',
    gemini: process.env.GEMINI_API_KEY ?? '',
  };

  const listings: Record<string, Listing> = {
    anthropic: keys.anthropic ? await listAnthropic(keys.anthropic) : { ok: false, error: 'no key set' },
    openai: keys.openai ? await listOpenAI(keys.openai) : { ok: false, error: 'no key set' },
    gemini: keys.gemini ? await listGemini(keys.gemini) : { ok: false, error: 'no key set' },
  };

  let problems = 0;

  for (const m of ANSWER_MODELS) {
    const listing = listings[m.provider];
    console.log(`\n=== ${m.label}  (${m.provider}) ===`);
    if (!listing.ok) {
      console.log(`  KEY FAILED: ${listing.error}`);
      problems++;
      continue;
    }
    console.log(`  key ok — ${listing.ids.length} models visible`);
    const hasPrimary = listing.ids.includes(m.primary);
    const hasFallback = listing.ids.includes(m.fallback);
    console.log(`  primary  ${m.primary}  ${hasPrimary ? 'FOUND' : 'NOT FOUND'}`);
    console.log(`  fallback ${m.fallback}  ${hasFallback ? 'FOUND' : 'NOT FOUND'}`);
    if (!hasPrimary) {
      problems++;
      console.log(`  candidates: ${candidates(m.primary, listing.ids).join(', ') || '(none matched)'}`);
    }
  }

  // Extraction + reasoning models both live on Anthropic.
  const anth = listings.anthropic;
  console.log(`\n=== support models (anthropic) ===`);
  if (!anth.ok) {
    console.log(`  KEY FAILED: ${anth.error}`);
  } else {
    for (const [label, id] of [
      ['extraction', EXTRACTION_MODEL],
      ['reasoning', REASONING_MODEL],
    ] as const) {
      const found = anth.ids.includes(id);
      console.log(`  ${label.padEnd(10)} ${id}  ${found ? 'FOUND' : 'NOT FOUND'}`);
      if (!found) {
        problems++;
        console.log(`    candidates: ${candidates(id, anth.ids).join(', ') || '(none matched)'}`);
      }
    }
  }

  // Gemini keys are commonly restricted to generation only, so when listing fails,
  // fall back to probing real generateContent calls before declaring the key dead.
  if (!listings.gemini.ok && keys.gemini) {
    console.log(`\n=== gemini generation probe (ListModels was blocked) ===`);
    const gm = ANSWER_MODELS.find((m) => m.provider === 'gemini')!;
    for (const candidate of [gm.primary, gm.fallback, 'gemini-3-pro', 'gemini-flash-latest']) {
      console.log(`  ${candidate.padEnd(22)} ${await probeGemini(keys.gemini, candidate)}`);
    }
  }

  if (process.argv.includes('--all')) {
    for (const [provider, listing] of Object.entries(listings)) {
      console.log(`\n--- all ${provider} models ---`);
      console.log(listing.ok ? listing.ids.join('\n') : listing.error);
    }
  }

  console.log(
    problems === 0
      ? '\nverify-models: all ids confirmed.'
      : `\nverify-models: ${problems} problem(s) above — update src/lib/config.ts (run with --all to dump every id).`
  );
}

main();

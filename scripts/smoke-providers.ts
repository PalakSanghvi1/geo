/**
 * One real search-grounded call per provider, plus one extraction pass.
 *
 *   npm run smoke
 *
 * This is the fastest way to tell whether a bad demo is the pipeline's fault or a
 * provider's: it exercises the exact adapters the runner uses, prints latency,
 * citation counts and the extracted mentions, and reports each provider
 * independently so one outage doesn't mask the others.
 */
import '../src/lib/env';
import { SEED_BRANDS } from '../src/lib/config';
import { callProvider } from '../src/pipeline/providers';
import { extractMentions } from '../src/pipeline/extract';
import type { Brand, ProviderId } from '../src/lib/types';

const PROMPT =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ??
  'What are the best production monitoring tools for AI agents?';

const BRANDS: Brand[] = SEED_BRANDS.map((b, i) => ({
  id: i + 1,
  name: b.name,
  is_self: b.isSelf ? 1 : 0,
  aliases: b.aliases ?? [],
}));

async function main() {
  console.log(`prompt: "${PROMPT}"\n`);
  let failures = 0;

  for (const provider of ['anthropic', 'openai', 'gemini'] as ProviderId[]) {
    console.log(`=== ${provider} ===`);
    try {
      const { answer, usedFallback, attempts } = await callProvider(provider, PROMPT);
      console.log(
        `  model ${answer.modelId}${usedFallback ? ' (FALLBACK)' : ''} · ${answer.latencyMs} ms · ` +
          `attempts ${attempts} · ${answer.text.length} chars · ${answer.citations.length} citations ` +
          `(${answer.citations.filter((c) => c.cited).length} cited)`
      );
      console.log(`  preview: ${answer.text.slice(0, 180).replace(/\s+/g, ' ')}…`);

      const { mentions, other_brands } = await extractMentions(answer.text, BRANDS);
      console.log(
        `  mentions: ${
          mentions.map((m) => `${m.order}.${m.brand}(${m.sentiment > 0 ? '+' : m.sentiment < 0 ? '-' : '0'})`).join(' ') ||
          '(none)'
        }`
      );
      if (other_brands.length) console.log(`  untracked: ${other_brands.join(', ')}`);
      const top = answer.citations.slice(0, 3).map((c) => new URL(c.url).hostname).join(', ');
      if (top) console.log(`  sources: ${top}`);
    } catch (err) {
      failures++;
      console.log(`  FAILED: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
    }
    console.log('');
  }

  console.log(failures === 0 ? 'smoke: all providers ok.' : `smoke: ${failures} provider(s) failed.`);
  process.exit(failures === 3 ? 1 : 0);
}

main();

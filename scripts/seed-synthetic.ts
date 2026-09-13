/**
 * Generate FABRICATED historical runs so the trend chart has depth.
 *
 *   npm run seed-synthetic -- --yes              # 90 days back
 *   npm run seed-synthetic -- --yes --days 120
 *   npm run seed-synthetic -- --purge --yes      # remove every synthetic run
 *
 * ---------------------------------------------------------------------------
 * THIS DATA IS NOT MEASURED. IT IS INVENTED.
 * ---------------------------------------------------------------------------
 * Every run it writes is tagged `trigger = 'synthetic'`, every answer body says so
 * in its first characters, and the Runs page shows the trigger, so provenance
 * travels with the row and no screen can present it as a measurement by accident.
 *
 * Three deliberate limits keep the fabrication from contaminating anything real:
 *
 *  1. It never touches a date that already has a real run.
 *  2. It writes NO citations, so the Sources page keeps aggregating real retrievals
 *     only. Source analysis stays 100% honest.
 *  3. Trajectories are anchored to the brands' real measured visibility, so the
 *     synthetic past converges on the observed present rather than contradicting it.
 *
 * Anyone demoing this must say the history is illustrative. Click into a REAL day
 * (`npm run status` lists triggers) when showing an individual answer.
 */
import '../src/lib/env';
import { getDb, all, get, run as exec } from '../src/lib/db';
import { SEED_BRANDS } from '../src/lib/config';
import type { ProviderId } from '../src/lib/types';

const PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'gemini'];
const MODEL_FOR: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.6-terra',
  gemini: 'gemini-3.1-pro-preview',
};

const SYNTHETIC_PREFIX = '[SYNTHETIC — fabricated for trend history, not a model response]';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function dateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Deterministic PRNG keyed by a string, so re-running produces the same history
 * instead of a different past every time.
 */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

interface BrandPlan {
  id: number;
  name: string;
  isSelf: boolean;
  start: number; // visibility % at the oldest synthetic day
  end: number; // visibility % at the boundary with real data
  strength: number; // drives ordering; higher = named earlier
  /** Target mean sentiment in [-1, 1], anchored to real measurement where we have it. */
  sentimentMean: number;
}

/**
 * Turn a target mean sentiment into per-label probabilities, so the fabricated
 * distribution reproduces the measured average instead of drifting from it.
 * p(+1) - p(-1) == mean by construction.
 */
function sentimentWeights(mean: number): { pPos: number; pNeg: number } {
  const m = Math.max(-1, Math.min(1, mean));
  const pNeg = Math.max(0.01, Math.min(0.3, 0.12 - m * 0.12));
  const pPos = Math.max(0.02, Math.min(0.95, m + pNeg));
  return { pPos, pNeg };
}

/** Measured mean sentiment per brand from real runs, in [-1, 1]. */
function realSentiment(): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of all<{ name: string; avg: number }>(
    `SELECT b.name AS name, AVG(m.sentiment) AS avg
       FROM mentions m
       JOIN answers a ON a.id = m.answer_id
       JOIN runs r ON r.id = a.run_id
       JOIN brands b ON b.id = m.brand_id
      WHERE a.status = 'ok' AND r.trigger != 'synthetic'
      GROUP BY b.id`
  )) {
    if (row.avg !== null) out.set(row.name, row.avg);
  }
  return out;
}

/** Measured visibility per brand from real (non-synthetic) runs. */
function realVisibility(): Map<string, number> {
  const totals = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM answers a JOIN runs r ON r.id = a.run_id
      WHERE a.status = 'ok' AND r.trigger != 'synthetic'`
  );
  const out = new Map<string, number>();
  if (!totals || totals.n === 0) return out;

  for (const row of all<{ name: string; hits: number }>(
    `SELECT b.name AS name, COUNT(DISTINCT a.id) AS hits
       FROM mentions m
       JOIN answers a ON a.id = m.answer_id
       JOIN runs r ON r.id = a.run_id
       JOIN brands b ON b.id = m.brand_id
      WHERE a.status = 'ok' AND r.trigger != 'synthetic'
      GROUP BY b.id`
  )) {
    out.set(row.name, (row.hits / totals.n) * 100);
  }
  return out;
}

function buildPlans(days: number): BrandPlan[] {
  const measured = realVisibility();
  const measuredSentiment = realSentiment();
  const brands = all<{ id: number; name: string; is_self: number }>(
    `SELECT id, name, is_self FROM brands ORDER BY id`
  );

  return brands.map((b) => {
    const seedName = SEED_BRANDS.find((s) => s.name === b.name);
    const end = measured.get(b.name) ?? (seedName?.isSelf ? 20 : 30);
    const r = rng(`plan:${b.name}`);

    // The self brand is a young company gaining ground; incumbents drift slightly
    // down as the category crowds. Both get an idiosyncratic slope so the lines
    // are not parallel.
    const isSelf = b.is_self === 1;
    const drift = isSelf ? 0.45 + r() * 0.25 : -0.12 + r() * 0.3;
    const start = Math.max(2, Math.min(85, end - end * drift));

    return {
      id: b.id,
      name: b.name,
      isSelf,
      start,
      end,
      strength: end,
      // AI answers about established tools skew positive, so an unmeasured brand
      // defaults to mildly positive rather than neutral — a fabricated -29 for a
      // well-regarded tool reads as obviously wrong to anyone who knows the space.
      sentimentMean: measuredSentiment.get(b.name) ?? (isSelf ? 0.5 : 0.3 + r() * 0.3),
    };
  });
}

/** Visibility for a brand on a given day: trend + weekly wobble + noise. */
function visibilityOn(plan: BrandPlan, dayIndex: number, totalDays: number, date: string): number {
  const t = totalDays <= 1 ? 1 : dayIndex / (totalDays - 1);
  const trend = plan.start + (plan.end - plan.start) * t;
  const r = rng(`${plan.name}:${date}`);
  const wobble = Math.sin((dayIndex / 7) * Math.PI * 2) * 2.2;
  const noise = (r() - 0.5) * 9;
  return Math.max(0, Math.min(96, trend + wobble + noise));
}

function purge() {
  const db = getDb();
  const runs = all<{ id: number }>(`SELECT id FROM runs WHERE trigger = 'synthetic'`);
  if (runs.length === 0) {
    console.log('purge: no synthetic runs present.');
    return;
  }
  const ids = runs.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  db.transaction(() => {
    db.prepare(
      `DELETE FROM mentions WHERE answer_id IN (SELECT id FROM answers WHERE run_id IN (${ph}))`
    ).run(...ids);
    db.prepare(`DELETE FROM answers WHERE run_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM runs WHERE id IN (${ph})`).run(...ids);
  })();
  console.log(`purge: removed ${runs.length} synthetic run(s).`);
}

function main() {
  const db = getDb();

  if (process.argv.includes('--purge')) {
    if (!process.argv.includes('--yes')) {
      console.log('Re-run with --yes to purge synthetic runs.');
      return;
    }
    purge();
    return;
  }

  const days = Number(flag('days') ?? 90);

  const prompts = all<{ id: number; text: string; tag: string | null }>(
    `SELECT id, text, tag FROM queries WHERE active = 1 ORDER BY id`
  );
  if (prompts.length === 0) {
    console.log('seed-synthetic: no prompts. Run `npm run seed` first.');
    return;
  }

  const plans = buildPlans(days);
  if (plans.length === 0) {
    console.log('seed-synthetic: no brands. Run `npm run seed` first.');
    return;
  }

  const existing = new Set(all<{ run_date: string }>(`SELECT DISTINCT run_date FROM runs`).map((r) => r.run_date));
  const targets: string[] = [];
  for (let i = days; i >= 1; i--) {
    const d = dateOffset(i);
    if (!existing.has(d)) targets.push(d);
  }

  const measured = realVisibility();
  console.log(
    `seed-synthetic: ${targets.length} day(s) to fabricate, ` +
      `${prompts.length} prompts x ${PROVIDERS.length} providers = ${prompts.length * PROVIDERS.length} answers/day.`
  );
  console.log(
    measured.size > 0
      ? `  anchored to measured visibility for ${measured.size} brand(s).`
      : '  no real data to anchor to — using defaults.'
  );

  if (!process.argv.includes('--yes')) {
    console.log('\nThis writes FABRICATED rows. Re-run with --yes to proceed.');
    return;
  }

  const insertRun = db.prepare(
    `INSERT INTO runs (run_date, trigger, status, started_at, finished_at, total_calls, ok_calls, failed_calls)
     VALUES (?, 'synthetic', 'complete', ?, ?, ?, ?, 0)`
  );
  const insertAnswer = db.prepare(
    `INSERT INTO answers (run_id, query_id, provider, model_id, status, answer_text, citations, other_brands, latency_ms, created_at)
     VALUES (?, ?, ?, ?, 'ok', ?, '[]', '[]', ?, ?)`
  );
  const insertMention = db.prepare(
    `INSERT INTO mentions (answer_id, brand_id, position, sentiment, quote) VALUES (?, ?, ?, ?, ?)`
  );

  let totalAnswers = 0;
  let totalMentions = 0;

  const writeDay = db.transaction((date: string, dayIndex: number) => {
    const perDay = prompts.length * PROVIDERS.length;
    const stamp = `${date} 09:00:00`;
    const runId = Number(insertRun.run(date, stamp, `${date} 09:08:00`, perDay, perDay).lastInsertRowid);

    // Today's visibility target per brand.
    const targetsForDay = new Map<number, number>();
    for (const plan of plans) {
      targetsForDay.set(plan.id, visibilityOn(plan, dayIndex, targets.length, date));
    }

    for (const prompt of prompts) {
      for (const provider of PROVIDERS) {
        const r = rng(`${date}:${prompt.id}:${provider}`);

        const present = plans.filter((plan) => {
          let p = (targetsForDay.get(plan.id) ?? 0) / 100;
          // A branded query names the brand it is about far more often; that is
          // why those prompts are tracked at all.
          if (prompt.tag === 'branded' && plan.isSelf) p = Math.min(0.95, p + 0.55);
          return r() < p;
        });

        if (present.length === 0) {
          // An answer that names nobody is still an answer — it counts in the
          // denominator, which is what makes visibility a share rather than a count.
          const id = Number(
            insertAnswer.run(
              runId,
              prompt.id,
              provider,
              MODEL_FOR[provider],
              `${SYNTHETIC_PREFIX} No tracked brand was named in this answer.`,
              14000 + Math.floor(r() * 18000),
              stamp
            ).lastInsertRowid
          );
          totalAnswers++;
          void id;
          continue;
        }

        // Higher-visibility brands tend to be named earlier, with real jitter.
        const ordered = present
          .map((plan) => ({ plan, score: plan.strength + (r() - 0.5) * 45 }))
          .sort((a, b) => b.score - a.score)
          .map((x) => x.plan);

        const names = ordered.map((p) => p.name).join(', ');
        const answerId = Number(
          insertAnswer.run(
            runId,
            prompt.id,
            provider,
            MODEL_FOR[provider],
            `${SYNTHETIC_PREFIX} Prompt: "${prompt.text}" Brands referenced, in order: ${names}.`,
            14000 + Math.floor(r() * 18000),
            stamp
          ).lastInsertRowid
        );
        totalAnswers++;

        ordered.forEach((plan, i) => {
          const { pPos, pNeg } = sentimentWeights(plan.sentimentMean);
          const draw = r();
          const sentiment = draw < pPos ? 1 : draw < pPos + pNeg ? -1 : 0;
          insertMention.run(answerId, plan.id, i + 1, sentiment, null);
          totalMentions++;
        });
      }
    }
  });

  targets.forEach((date, i) => {
    writeDay(date, i);
    if ((i + 1) % 15 === 0 || i === targets.length - 1) {
      console.log(`  ${i + 1}/${targets.length} days written`);
    }
  });

  console.log(
    `\nseed-synthetic: wrote ${targets.length} synthetic run(s), ` +
      `${totalAnswers} answers, ${totalMentions} mentions.`
  );
  console.log('Every one is tagged trigger=\'synthetic\' and carries no citations.');
  console.log('Say the history is illustrative when demoing; click a real day for answer detail.');
}

main();

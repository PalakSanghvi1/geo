/**
 * GET /api/prompts  ->  PromptRow[]
 *
 * One row per active query (base queries and their variations), ordered so
 * variations sit directly under their parent — the Prompts table indents them.
 *
 * Per row:
 *   selfVisibility  self-brand visibility over the MOST RECENT run date
 *                   (ok answers for this query mentioning us / ok answers)
 *   topBrands       the 3 brands most often mentioned in this query's answers
 *   latestAnswerIds the newest ok answer id per provider, for deep links
 *
 * This is the one endpoint with its own SQL; everything is aggregated in a
 * handful of grouped queries rather than per-row lookups.
 */
import { all, get } from '@/lib/db';
import type { PromptRow, ProviderId } from '@/lib/types';
import { measuredRunsClause } from '@/lib/provenance';
import { asProviderId, fail, ok } from '../_lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOP_BRANDS = 3;

interface QueryRow {
  id: number;
  text: string;
  tag: string | null;
  parent_id: number | null;
}

export async function GET() {
  try {
    const queries = all<QueryRow>(
      `SELECT id, text, tag, parent_id
         FROM queries
        WHERE active = 1
        ORDER BY COALESCE(parent_id, id) ASC, parent_id IS NOT NULL, id ASC`
    );

    // Empty DB (or nothing seeded yet) — nothing else is worth querying.
    if (queries.length === 0) return ok<PromptRow[]>([]);

    const latestDate = get<{ run_date: string }>(
      `SELECT r.run_date AS run_date
         FROM runs r
         JOIN answers a ON a.run_id = r.id
        ORDER BY r.run_date DESC
        LIMIT 1`
    )?.run_date;

    const selfBrandId = get<{ id: number }>(
      `SELECT id FROM brands WHERE is_self = 1 LIMIT 1`
    )?.id;

    /* --- self visibility on the latest run date, per query ---------------- */
    const visibility = new Map<number, { total: number; hits: number }>();
    if (latestDate !== undefined && selfBrandId !== undefined) {
      const rows = all<{ query_id: number; total: number; hits: number }>(
        `SELECT a.query_id AS query_id,
                COUNT(DISTINCT a.id) AS total,
                COUNT(DISTINCT m.answer_id) AS hits
           FROM answers a
           JOIN runs r ON r.id = a.run_id
           LEFT JOIN mentions m ON m.answer_id = a.id AND m.brand_id = ?
          WHERE a.status = 'ok' AND r.run_date = ?
          GROUP BY a.query_id`,
        [selfBrandId, latestDate]
      );
      for (const row of rows) {
        visibility.set(row.query_id, { total: row.total, hits: row.hits });
      }
    }

    /* --- top brands per query, over measured answers only ----------------- */
    // This aggregated every ok answer with no provenance filter, so on a database
    // carrying months of illustrative history the list was decided by generated
    // mentions — and sat in the same row as `selfVisibility`, which is computed on
    // the latest day alone. One row, two provenances, no way to tell them apart.
    const topBrands = new Map<number, string[]>();
    {
      const rows = all<{ query_id: number; brand: string; mentions: number }>(
        `SELECT a.query_id AS query_id,
                b.name AS brand,
                COUNT(*) AS mentions
           FROM mentions m
           JOIN answers a ON a.id = m.answer_id
           JOIN runs r ON r.id = a.run_id
           JOIN brands b ON b.id = m.brand_id
          WHERE a.status = 'ok' AND ${measuredRunsClause()}
          GROUP BY a.query_id, b.id
          ORDER BY a.query_id ASC, mentions DESC, b.name ASC`
      );
      for (const row of rows) {
        const list = topBrands.get(row.query_id) ?? [];
        if (list.length < TOP_BRANDS) {
          list.push(row.brand);
          topBrands.set(row.query_id, list);
        }
      }
    }

    /* --- newest ok answer per (query, provider) --------------------------- */
    const latestAnswers = new Map<number, Partial<Record<ProviderId, number>>>();
    {
      const rows = all<{ query_id: number; provider: string; answer_id: number }>(
        `SELECT query_id, provider, answer_id FROM (
           SELECT a.query_id AS query_id,
                  a.provider AS provider,
                  a.id AS answer_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY a.query_id, a.provider
                    ORDER BY r.run_date DESC, a.id DESC
                  ) AS rn
             FROM answers a
             JOIN runs r ON r.id = a.run_id
            WHERE a.status = 'ok'
         )
         WHERE rn = 1`
      );
      for (const row of rows) {
        const provider = asProviderId(row.provider);
        if (provider === null) continue; // ignore anything not in the union
        const entry = latestAnswers.get(row.query_id) ?? {};
        entry[provider] = row.answer_id;
        latestAnswers.set(row.query_id, entry);
      }
    }

    const rows: PromptRow[] = queries.map((q) => {
      const vis = visibility.get(q.id);
      const selfVisibility =
        vis && vis.total > 0 ? Math.round((vis.hits / vis.total) * 1000) / 10 : 0;

      return {
        queryId: q.id,
        text: q.text,
        tag: q.tag,
        isVariation: q.parent_id !== null,
        parentId: q.parent_id,
        selfVisibility,
        topBrands: topBrands.get(q.id) ?? [],
        latestAnswerIds: latestAnswers.get(q.id) ?? {},
      };
    });

    return ok(rows);
  } catch (err) {
    return fail(err);
  }
}

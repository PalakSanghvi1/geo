'use client';

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { PROJECT, SEED_BRANDS } from '@/lib/config';
import type { AnswerDetailResponse, Citation, ProviderId } from '@/lib/types';
import { Badge, Card, ErrorState, Overline, Skeleton, cx } from '@/app/_components/ui';
import { useAnswerDetail } from '@/app/_lib/fetcher';

const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Claude',
  openai: 'GPT',
  gemini: 'Gemini',
};

const SENTIMENT_LABEL = ['negative', 'neutral', 'positive'] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Highlighter {
  re: RegExp;
  lookup: Map<string, boolean>;
}

/**
 * Terms come from this answer's own mentions first — that list is authoritative
 * and includes competitors approved after seed time — then from the seed config
 * for the aliases the extractor normalised away. Longest first, so
 * "Weights & Biases Weave" wins over a bare "Weave".
 */
function buildHighlighter(mentions: Array<{ brandName: string; isSelf: boolean }>): Highlighter {
  const terms = [
    ...mentions.map((m) => ({ term: m.brandName, isSelf: m.isSelf })),
    ...SEED_BRANDS.flatMap((brand) =>
      [brand.name, ...(brand.aliases ?? [])].map((term) => ({
        term,
        isSelf: brand.isSelf === true,
      }))
    ),
  ]
    .filter((t) => t.term.trim().length > 0)
    .sort((a, b) => b.term.length - a.term.length);

  const lookup = new Map<string, boolean>();
  for (const t of terms) {
    if (!lookup.has(t.term.toLowerCase())) lookup.set(t.term.toLowerCase(), t.isSelf);
  }

  const unique = [...new Set(terms.map((t) => t.term))];
  return {
    lookup,
    re: new RegExp(`\\b(${unique.map(escapeRegExp).join('|')})\\b`, 'gi'),
  };
}

function highlight(text: string, { re, lookup }: Highlighter): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  re.lastIndex = 0;

  let match = re.exec(text);
  while (match !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const isSelf = lookup.get(match[0].toLowerCase()) ?? false;
    nodes.push(
      <mark
        key={`m${key++}`}
        title={isSelf ? 'Your brand' : 'Competitor'}
        className={cx(
          'rounded px-1 py-0.5',
          isSelf ? 'bg-accent-wash font-medium text-ink' : 'bg-ink/[0.06] text-ink'
        )}
      >
        {match[0]}
      </mark>
    );
    cursor = match.index + match[0].length;
    match = re.exec(text);
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD HH:MM:SS' -> 'Sep 13 · 09:04'. Returns the input if unparseable. */
function formatStamp(stamp: string): string {
  const [date, time = ''] = stamp.split(' ');
  const [, month, day] = date.split('-').map(Number);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return stamp;
  const label = `${MONTHS[month - 1]} ${day}`;
  return time ? `${label} · ${time.slice(0, 5)}` : label;
}

function domainOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return url;
  }
}

interface DomainGroup {
  domain: string;
  count: number;
  cited: boolean;
}

function groupCitations(citations: Citation[]): DomainGroup[] {
  const byDomain = new Map<string, DomainGroup>();
  for (const citation of citations) {
    const domain = domainOf(citation.url);
    const entry = byDomain.get(domain) ?? { domain, count: 0, cited: false };
    entry.count += 1;
    // A domain counts as cited if the model cited it at least once.
    entry.cited = entry.cited || citation.cited !== false;
    byDomain.set(domain, entry);
  }
  return [...byDomain.values()].sort((a, b) => b.count - a.count);
}

/** Mono chip in the header: provider/model, run id, timestamp. */
function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-hairline bg-card px-2.5 py-1.5 font-mono text-[11px] whitespace-nowrap text-ink-muted">
      {children}
    </span>
  );
}

function RailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <div className="px-5 pt-3.5 pb-1">
        <Overline>{title}</Overline>
      </div>
      <div className="px-5 pb-3.5">{children}</div>
    </Card>
  );
}

export function AnswerDetail({ answerId }: { answerId: number }) {
  const { data, error, loading, refresh } = useAnswerDetail(answerId);

  const citations = useMemo(
    () => groupCitations(data?.answer.citations ?? []),
    [data?.answer.citations]
  );

  const highlighter = useMemo(() => buildHighlighter(data?.mentions ?? []), [data?.mentions]);

  if (!Number.isInteger(answerId) || answerId <= 0) {
    return (
      <div className="px-8 py-8">
        <Card>
          <ErrorState message="That is not a valid answer id." />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-8 py-8">
        <Card>
          <ErrorState message={error} onRetry={refresh} />
        </Card>
      </div>
    );
  }

  const answer = data?.answer;
  const quote = data?.mentions.find((m) => m.isSelf && m.quote)?.quote ?? null;

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4 px-8 pt-7 pb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13px] text-ink-muted">
            <Link href="/prompts" className="rounded text-accent-ink transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              Prompts
            </Link>
            <span aria-hidden>/</span>
            <span className="truncate">{data?.queryText ?? '…'}</span>
          </div>
          <h1 className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.01em]">
            Answer detail
          </h1>
        </div>
        {answer ? (
          <div className="flex flex-wrap items-center gap-2">
            <MetaChip>
              {PROVIDER_LABEL[answer.provider]} · {answer.model_id}
            </MetaChip>
            <MetaChip>Run #{answer.run_id}</MetaChip>
            <MetaChip>{formatStamp(answer.created_at)}</MetaChip>
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-4 px-8 pb-12 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="px-5 py-5">
          {loading || !answer ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3 w-48" />
              <Skeleton className="mt-3 h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              <h2 className="text-[15px] font-semibold">“{data.queryText}”</h2>
              <p className="mt-1 text-[13px] text-ink-muted">
                Answer collected with live web search
                {answer.latency_ms != null ? ` · ${(answer.latency_ms / 1000).toFixed(1)}s` : ''} ·{' '}
                {answer.citations.length} citation{answer.citations.length === 1 ? '' : 's'}
              </p>

              {answer.status === 'error' ? (
                <div className="mt-5 rounded-card border border-down/30 px-4 py-3 text-sm text-down">
                  This call failed: {answer.error ?? 'no answer was returned.'}
                </div>
              ) : !answer.answer_text ? (
                <div className="mt-5 rounded-card border border-hairline px-4 py-3 text-sm text-ink-muted">
                  The call succeeded but the model returned no text.
                </div>
              ) : (
                <div className="mt-5 flex flex-col gap-4 text-[15px] leading-7">
                  {answer.answer_text.split('\n\n').map((paragraph, i) => (
                    <p key={i}>{highlight(paragraph, highlighter)}</p>
                  ))}
                </div>
              )}

              <div className="mt-6 flex items-center gap-4 border-t border-hairline pt-4 text-[12px] text-ink-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-accent" aria-hidden />
                  Your brand
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-ink/[0.12]" aria-hidden />
                  Competitor
                </span>
              </div>
            </>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <RailCard title={`Mentions · in order`}>
            {loading || !data ? (
              <Skeleton className="h-28 w-full" />
            ) : data.mentions.length === 0 ? (
              <p className="py-2 text-sm text-ink-muted">No tracked brand was named.</p>
            ) : (
              <ul>
                {data.mentions.map((mention) => (
                  <li
                    key={mention.id}
                    className={cx(
                      '-mx-2 flex items-center gap-2 rounded px-2 py-1.5 text-sm',
                      mention.isSelf && 'bg-accent-wash'
                    )}
                  >
                    <span className="numeric w-4 text-[11px] text-ink-faint">
                      {mention.position}
                    </span>
                    <span className={cx('flex-1', mention.isSelf && 'font-medium')}>
                      {mention.brandName}
                    </span>
                    <span
                      className={cx(
                        'text-[12px]',
                        mention.sentiment > 0
                          ? 'text-up'
                          : mention.sentiment < 0
                            ? 'text-down'
                            : 'text-ink-muted'
                      )}
                    >
                      {SENTIMENT_LABEL[mention.sentiment + 1]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </RailCard>

          {quote ? (
            <RailCard title="Extracted quote">
              <blockquote className="border-l-2 border-hairline-strong pl-3 text-[13px] leading-6 text-ink-muted">
                “…{quote}.”
              </blockquote>
            </RailCard>
          ) : null}

          {answer && answer.other_brands.length > 0 ? (
            <RailCard title="Untracked brands spotted">
              <div className="flex flex-wrap gap-1.5">
                {answer.other_brands.map((brand) => (
                  <Badge key={brand}>{brand}</Badge>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-ink-muted">
                Named in this answer but not tracked against {PROJECT.name}.
              </p>
            </RailCard>
          ) : null}

          <RailCard title={`Citations · ${citations.length}`}>
            {loading || !answer ? (
              <Skeleton className="h-24 w-full" />
            ) : citations.length === 0 ? (
              <p className="py-2 text-sm text-ink-muted">This answer cited no sources.</p>
            ) : (
              <ul className="flex flex-col">
                {citations.map((entry) => (
                  <li
                    key={entry.domain}
                    className="flex items-center gap-2 border-b border-hairline py-2 text-sm last:border-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${entry.domain}&sz=32`}
                      alt=""
                      width={14}
                      height={14}
                      referrerPolicy="no-referrer"
                      className="h-3.5 w-3.5 shrink-0 rounded-sm"
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.domain}</span>
                    {!entry.cited ? (
                      <span className="text-[11px] text-ink-muted">retrieved</span>
                    ) : null}
                    <span className="numeric text-[12px] text-ink-muted">×{entry.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </RailCard>
        </div>
      </div>
    </>
  );
}

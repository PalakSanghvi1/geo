'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader, Segmented } from '@/app/_components/filters';
import { Badge, Button, Card, EmptyState, ErrorBanner, ErrorState, METER_W, Meter, FieldLabel, Skeleton, cx } from '@/app/_components/ui';
import { usePrompts } from '@/app/_lib/fetcher';
import type { PromptRow, ProviderId } from '@/lib/types';

const CELL = 'px-5 py-3';

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Sentinel for the unfiltered segment — a real tag is always a plain word. */
const ALL_TAGS = '*';

const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'openai', 'gemini'];
const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Claude',
  openai: 'GPT',
  gemini: 'Gemini',
};

interface Group {
  base: PromptRow;
  variations: PromptRow[];
}

/**
 * One group per base query, variations attached by `parentId`. A variation whose
 * parent is missing from the response becomes its own group rather than vanishing.
 */
function groupPrompts(rows: PromptRow[]): Group[] {
  const byQueryId = new Map<number, Group>();
  const groups: Group[] = [];
  const orphans: Group[] = [];

  for (const row of rows) {
    if (row.isVariation) continue;
    const group: Group = { base: row, variations: [] };
    byQueryId.set(row.queryId, group);
    groups.push(group);
  }

  for (const row of rows) {
    if (!row.isVariation) continue;
    const parent = row.parentId === null ? undefined : byQueryId.get(row.parentId);
    if (parent) parent.variations.push(row);
    else orphans.push({ base: row, variations: [] });
  }

  return groups.concat(orphans);
}

function distinctTags(rows: PromptRow[]): string[] {
  const tags = new Set<string>();
  for (const row of rows) {
    if (row.tag) tags.add(row.tag);
  }
  return [...tags].sort();
}

function titleCase(tag: string): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

function countPrompts(groups: Group[]): number {
  return groups.reduce((total, group) => total + 1 + group.variations.length, 0);
}

function HeaderRow() {
  return (
    <thead>
      <tr className="border-b border-hairline">
        <th scope="col" className={cx(CELL, 'field-label text-left')}>
          Prompt
        </th>
        <th scope="col" className={cx(CELL, 'field-label text-left whitespace-nowrap')}>
          Tag
        </th>
        <th scope="col" className={cx(CELL, 'field-label text-left whitespace-nowrap')}>
          Visibility
        </th>
        <th scope="col" className={cx(CELL, 'field-label text-left whitespace-nowrap')}>
          Top brands
        </th>
        <th scope="col" className={cx(CELL, 'field-label text-left whitespace-nowrap')}>
          Answers
        </th>
      </tr>
    </thead>
  );
}

function AnswerLinks({ ids, prompt }: { ids: PromptRow['latestAnswerIds']; prompt: string }) {
  const links = PROVIDER_ORDER.flatMap((provider) => {
    const id = ids[provider];
    return id === undefined ? [] : [{ provider, id }];
  });

  if (links.length === 0) return <span className="text-ink-faint">—</span>;

  return (
    <div className="flex items-center gap-1.5">
      {links.map(({ provider, id }) => (
        // Without the label the 45 links read as "Claude, GPT, Gemini" over and over.
        <Link
          key={provider}
          href={`/answers/${id}`}
          aria-label={`${PROVIDER_LABELS[provider]} answer for "${prompt}"`}
          className={cx(
            'rounded border border-accent/20 bg-accent-wash px-1.5 py-0.5 text-[12px] text-accent-ink transition-colors hover:border-accent/40',
            FOCUS_RING
          )}
        >
          {PROVIDER_LABELS[provider]}
        </Link>
      ))}
    </div>
  );
}

function PromptCells({ row }: { row: PromptRow }) {
  return (
    <>
      <td className={CELL}>
        <div className="flex items-center gap-3">
          <span className="numeric w-9 text-right">{row.selfVisibility.toFixed(0)}%</span>
          <div className={METER_W}>
            <Meter value={row.selfVisibility} self />
          </div>
        </div>
      </td>
      <td className={cx(CELL, 'text-[13px] text-ink-muted')}>
        {row.topBrands.length === 0 ? '—' : row.topBrands.join(' · ')}
      </td>
      <td className={CELL}>
        <AnswerLinks ids={row.latestAnswerIds} prompt={row.text} />
      </td>
    </>
  );
}

/** A base query and its variations, kept together in one tbody. */
function GroupRows({ group }: { group: Group }) {
  return (
    <tbody>
      <tr className="border-b border-hairline">
        <td className={CELL}>{group.base.text}</td>
        <td className={CELL}>{group.base.tag ? <Badge>{group.base.tag}</Badge> : null}</td>
        <PromptCells row={group.base} />
      </tr>
      {group.variations.map((variation) => (
        <tr key={variation.queryId} className="border-b border-hairline text-ink-muted">
          <td className={CELL}>
            <div className="flex items-center gap-2 pl-6">
              <span>{variation.text}</span>
              <Badge>Variation</Badge>
            </div>
          </td>
          <td className={CELL} />
          <PromptCells row={variation} />
        </tr>
      ))}
    </tbody>
  );
}

function PromptsSkeleton() {
  return (
    <tbody>
      {Array.from({ length: 8 }, (_, i) => (
        <tr key={i} className="border-b border-hairline">
          <td className={CELL}>
            <Skeleton className={cx('h-3', i % 3 === 0 ? 'w-72' : 'ml-6 w-64')} />
          </td>
          <td className={CELL}>{i % 3 === 0 ? <Skeleton className="h-3 w-16" /> : null}</td>
          <td className={CELL}>
            <div className="flex items-center gap-3">
              <Skeleton className="h-3 w-9" />
              <Skeleton className={cx('h-[3px]', METER_W)} />
            </div>
          </td>
          <td className={CELL}>
            <Skeleton className="h-3 w-40" />
          </td>
          <td className={CELL}>
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-9" />
              <Skeleton className="h-4 w-12" />
            </div>
          </td>
        </tr>
      ))}
    </tbody>
  );
}

export default function PromptsPage() {
  const prompts = usePrompts();
  const [tag, setTag] = useState<string>(ALL_TAGS);

  const rows = prompts.data ?? [];
  const groups = useMemo(() => groupPrompts(rows), [rows]);
  const tags = useMemo(() => distinctTags(rows), [rows]);

  // Filtering on the base keeps every group intact — variations share their tag.
  const visible = useMemo(
    () => (tag === ALL_TAGS ? groups : groups.filter((group) => group.base.tag === tag)),
    [groups, tag]
  );

  const tagOptions = [
    { value: ALL_TAGS, label: 'All' },
    ...tags.map((value) => ({ value, label: titleCase(value) })),
  ];

  return (
    <>
      <PageHeader
        title="Prompts"
        subtitle="Every tracked base query, with its AI-generated variations grouped beneath it."
      >
        {/* Mounted while loading too, so the control doesn't pop in a beat after paint. */}
        <div inert={prompts.loading} className={prompts.loading ? 'opacity-50' : undefined}>
          <Segmented label="Prompt tag" value={tag} options={tagOptions} onChange={setTag} />
        </div>
      </PageHeader>

      <div className="flex flex-col gap-4 px-8 pb-12">
        {prompts.error && prompts.data === null ? (
          <Card>
            <ErrorState message={prompts.error} onRetry={prompts.refresh} />
          </Card>
        ) : (
          <>
            {/* A failed refresh sits above the last good table rather than replacing it. */}
            {prompts.error ? (
              <ErrorBanner message={prompts.error} onRetry={prompts.refresh} />
            ) : null}

            <FieldLabel>
              {prompts.loading
                ? 'Loading prompts'
                : `${visible.length} base ${visible.length === 1 ? 'query' : 'queries'} · ${countPrompts(
                    visible
                  )} prompts`}
            </FieldLabel>

            <Card>
              {!prompts.loading && visible.length === 0 ? (
                rows.length === 0 ? (
                  <EmptyState
                    title="No prompts tracked yet."
                    hint="Queries appear here once the first run has been collected."
                  />
                ) : (
                  <EmptyState
                    title={`No prompts tagged "${tag}".`}
                    hint="Clear the filter to see every tracked prompt."
                  />
                )
              ) : (
                <table className="w-full text-sm [&_tbody:last-of-type_tr:last-of-type]:border-0">
                  <HeaderRow />
                  {prompts.loading ? (
                    <PromptsSkeleton />
                  ) : (
                    visible.map((group) => <GroupRows key={group.base.queryId} group={group} />)
                  )}
                </table>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}

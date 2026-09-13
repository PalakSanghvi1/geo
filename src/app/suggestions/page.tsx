import type { Metadata } from 'next';
import { PageHeader } from '@/app/_components/filters';
import { ComingSoon } from '@/app/_components/ui';

export const metadata: Metadata = {
  title: 'Suggestions — GEO',
};

export default function SuggestionsPage() {
  return (
    <>
      <PageHeader
        title="Suggestions"
        subtitle="Queries and competitors worth tracking, drawn from the team's Linear roadmap."
      />
      <div className="px-8 pb-10">
        <ComingSoon page="Suggestions" phase="Phase B3" />
      </div>
    </>
  );
}

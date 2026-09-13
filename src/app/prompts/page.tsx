import type { Metadata } from 'next';
import { PageHeader } from '@/app/_components/filters';
import { ComingSoon } from '@/app/_components/ui';

export const metadata: Metadata = {
  title: 'Prompts — GEO',
};

export default function PromptsPage() {
  return (
    <>
      <PageHeader
        title="Prompts"
        subtitle="The 45 tracked prompts — 15 base queries plus two AI variations each, grouped by query."
      />
      <div className="px-8 pb-10">
        <ComingSoon page="Prompts" phase="Phase B2" />
      </div>
    </>
  );
}

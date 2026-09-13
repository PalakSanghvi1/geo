import type { Metadata } from 'next';
import { PageHeader } from '@/app/_components/filters';
import { ComingSoon } from '@/app/_components/ui';

export const metadata: Metadata = {
  title: 'Sources — GEO',
};

export default function SourcesPage() {
  return (
    <>
      <PageHeader
        title="Sources"
        subtitle="Which domains the AI models cite in their answers, and which of them competitors own."
      />
      <div className="px-8 pb-10">
        <ComingSoon page="Sources" phase="Phase B3" />
      </div>
    </>
  );
}

import type { Metadata } from 'next';
import { PageHeader } from '@/app/_components/filters';
import { ComingSoon } from '@/app/_components/ui';

export const metadata: Metadata = {
  title: 'Runs — GEO',
};

export default function RunsPage() {
  return (
    <>
      <PageHeader
        title="Runs"
        subtitle="Every prompt × model execution, with retry history and per-provider health."
      />
      <div className="px-8 pb-10">
        <ComingSoon page="Runs" phase="Phase B2" />
      </div>
    </>
  );
}

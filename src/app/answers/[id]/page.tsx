import type { Metadata } from 'next';
import { AnswerDetail } from './answer-detail';

export const metadata: Metadata = {
  title: 'Answer detail — GEO',
};

export default async function AnswerPage(props: PageProps<'/answers/[id]'>) {
  const { id } = await props.params;
  return <AnswerDetail answerId={Number(id)} />;
}

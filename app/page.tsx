import { AnalystDashboard } from '@/components/analyst/analyst-dashboard';
import { QualityProposalFour } from '@/components/analyst/quality-proposal-four';

/**
 * Main quality overview uses improvement 2.
 * Historic overview and comparison URLs remain accessible without navigation tabs.
 * Keep all historic contract/overview deep links working.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{view?: string | string[];variant?:string|string[]}>;
}) {
  const params = await searchParams;
  const view = params?.view;
  if (view === 'overview' || view === 'contract') return <AnalystDashboard />;
  return <QualityProposalFour variant={params?.variant==='improvement2'?'improvement2':params?.variant==='improvement1'?'improvement1':params?.variant==='current'?'current':'improvement2'} />;
}

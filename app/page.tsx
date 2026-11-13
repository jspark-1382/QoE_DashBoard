import { AnalystDashboard } from '@/components/analyst/analyst-dashboard';
import { QualityProposalFour } from '@/components/analyst/quality-proposal-four';
import { ServerQualityOverview } from '@/components/analyst/server-quality-overview';

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
  if(params?.variant==='current'||params?.variant==='improvement1')return <QualityProposalFour variant={params.variant}/>;
  return <ServerQualityOverview />;
}

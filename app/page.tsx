import { AnalystDashboard } from '@/components/analyst/analyst-dashboard';
import { QualityProposalFour } from '@/components/analyst/quality-proposal-four';

/**
 * Main quality overview is the former proposal 4.
 * The original overview remains a separately named "기존안" tab.
 * Keep all historic contract/overview deep links working.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{view?: string | string[]}>;
}) {
  const params = await searchParams;
  const view = params?.view;
  if (view === 'overview' || view === 'contract') return <AnalystDashboard />;
  return <QualityProposalFour />;
}

import type { AnalystOverview } from './types';

export function scopeOverviewToCustomers(overview: AnalystOverview, customerIds: readonly string[]): AnalystOverview;
export function scopeOverviewToCustomers(overview: AnalystOverview | null, customerIds: readonly string[]): AnalystOverview | null;
/** Empty selection restores the full source; a nonempty unmatched selection stays empty. */
export function scopeOverviewToCustomers(overview: AnalystOverview | null, customerIds: readonly string[]): AnalystOverview | null {
  if (!overview || !customerIds.length) return overview;
  const selected = new Set(customerIds);
  const calls = overview.calls.filter(call => selected.has(call.customerId));
  const callIds = new Set(calls.map(call => call.id));
  const callLocations = (overview.callLocations ?? []).filter(point => callIds.has(point.callId));
  const evidence = new Map(callLocations.map(point => [point.callId, point.evidence]));
  return { ...overview, calls, callLocations,
    cells: overview.cells.map(cell => {
      const ids = cell.callIds.filter(id => callIds.has(id));
      return { ...cell, callIds: ids,
        ...(cell.gnssCalls == null ? {} : { gnssCalls: ids.filter(id => evidence.get(id) === 'gnss').length }),
        ...(cell.estimatedCalls == null ? {} : { estimatedCalls: ids.filter(id => evidence.get(id) === 'estimated').length }),
        ...(cell.byeCellCalls == null ? {} : { byeCellCalls: ids.filter(id => evidence.get(id) === 'bye-cell').length }),
      };
    }),
  };
}

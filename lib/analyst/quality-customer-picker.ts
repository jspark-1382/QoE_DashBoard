import { dateOfCall } from './date-range';
import { buildOriginalCallLink } from './improved-overview';
import type { AnalystDataset, AnalystOverview, OverviewCall } from './types';

export type QualityCustomerFilter = 'all' | 'poor' | 'repeat';
export interface QualityCustomerRow {
  customerId: string;
  /** The original service number; opaque customer identities are never a substitute. */
  sourceContractId: string | null;
  contractIds: string[];
  totalCalls: number;
  poorCalls: number;
  locatedCalls: number;
  unlocatedCalls: number;
  latestCall: OverviewCall;
  latestDate: string;
  href: string;
}

const compareIdentity = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const originalId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const clockSeconds = (value: string) => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 3600 + minute * 60;
};
const sourceClock = (call: OverviewCall) => {
  // Compare original local source clocks, without the machine's timezone or Date parsing.
  const clock = call.startTimestamp?.match(/T((?:[01]\d|2[0-3])):([0-5]\d):([0-5]\d)(\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  return clock ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) + Number(clock[4] ?? 0)
    : call.startSecond;
};
const recentFirst = (a: OverviewCall, b: OverviewCall, fallback: string) =>
  compareIdentity(dateOfCall(b, fallback), dateOfCall(a, fallback)) ||
  sourceClock(b) - sourceClock(a) || compareIdentity(a.id, b.id);

/** Uses only the overview and manifest metadata; never fetches or reads detail partitions. */
export function buildQualityCustomerRows(
  dataset: AnalystDataset | null,
  overview: AnalystOverview | null,
  from: string,
  to: string,
): QualityCustomerRow[] {
  if (!dataset || !overview) return [];
  const firstSecond = clockSeconds(from), lastSecond = clockSeconds(to);
  if (firstSecond === null || lastSecond === null || firstSecond > lastSecond) return [];
  const scopeDates = overview.date.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const fallbackDate = scopeDates[0] ?? overview.date;
  const lastDate = scopeDates.at(-1) ?? fallbackDate;
  const customerById = new Map(dataset.customers.map(customer => [customer.id, customer]));
  const dayIds = new Map<string, string[]>();
  for (const day of [...dataset.days].sort((a, b) => compareIdentity(b.date, a.date))) {
    if (day.date < fallbackDate || day.date > lastDate || !originalId(day.sourceContractId)) continue;
    const ids = dayIds.get(day.customerId) ?? [];
    ids.push(day.sourceContractId);
    dayIds.set(day.customerId, ids);
  }
  const located = new Set((overview.callLocations ?? [])
    .filter(point => Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 &&
      Number.isFinite(point.lon) && Math.abs(point.lon) <= 180)
    .map(point => point.callId));
  const grouped = new Map<string, Map<string, OverviewCall>>();
  for (const call of overview.calls) {
    if (!Number.isFinite(call.startSecond) || call.startSecond < firstSecond || call.startSecond >= lastSecond + 60) continue;
    const calls = grouped.get(call.customerId) ?? new Map<string, OverviewCall>();
    if (!calls.has(call.id)) calls.set(call.id, call);
    grouped.set(call.customerId, calls);
  }
  const rows: QualityCustomerRow[] = [];
  for (const [customerId, byId] of grouped) {
    const calls = [...byId.values()].sort((a, b) => recentFirst(a, b, fallbackDate));
    const latestCall = calls[0];
    const customerNumber = customerById.get(customerId)?.sourceContractId;
    const callIds = calls.map(call => call.contractId).filter(originalId);
    const identifiers = [customerNumber, ...callIds, ...(dayIds.get(customerId) ?? [])].filter(originalId);
    const contractIds = [...new Set(identifiers)];
    const sourceContractId = originalId(customerNumber) ? customerNumber : contractIds[0] ?? null;
    const locatedCalls = calls.filter(call => located.has(call.id)).length;
    const latestDate = dateOfCall(latestCall, fallbackDate);
    rows.push({
      customerId, sourceContractId, contractIds,
      totalCalls: calls.length,
      poorCalls: calls.filter(call => typeof call.mos === 'number' && Number.isFinite(call.mos) && call.mos >= 1 && call.mos < 3).length,
      locatedCalls, unlocatedCalls: calls.length - locatedCalls,
      latestCall, latestDate, href: buildOriginalCallLink(latestCall, latestDate),
    });
  }
  return rows.sort((a, b) => b.poorCalls - a.poorCalls || compareIdentity(a.customerId, b.customerId));
}

export function qualityCustomerPage(
  rows: readonly QualityCustomerRow[],
  query: string,
  filter: QualityCustomerFilter,
  requestedPage: number,
) {
  const needle = query.trim().toLowerCase();
  const matches = rows.filter(row =>
    (!needle || row.contractIds.some(id => id.toLowerCase().includes(needle))) &&
    (filter === 'all' || row.poorCalls >= (filter === 'repeat' ? 2 : 1)));
  const pages = Math.ceil(matches.length / 25);
  const page = Math.max(0, Math.min(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 0, Math.max(0, pages - 1)));
  return { rows: matches.slice(page * 25, page * 25 + 25), total: matches.length, page, pages };
}

/** Preserve opaque identities, including selected customers without calls in the current window. */
export function qualityCustomerSelectionIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(id => typeof id === 'string' && id.trim().length > 0))];
}

export function updateQualityCustomerSelection(
  selectedIds: readonly string[], customerIds: readonly string[], checked: boolean,
): string[] {
  const selected = new Set(qualityCustomerSelectionIds(selectedIds));
  for (const id of qualityCustomerSelectionIds(customerIds)) {
    if (checked) selected.add(id);
    else selected.delete(id);
  }
  return [...selected];
}

export function summarizeQualityCustomerSelection(rows: readonly QualityCustomerRow[], ids: readonly string[]) {
  const customerIds = qualityCustomerSelectionIds(ids);
  const selected = new Set(customerIds);
  const selectedRows = rows.filter(row => selected.has(row.customerId));
  return {
    customerIds, rows: selectedRows, count: customerIds.length,
    withoutCalls: customerIds.length - selectedRows.length,
    totalCalls: selectedRows.reduce((sum, row) => sum + row.totalCalls, 0),
    poorCalls: selectedRows.reduce((sum, row) => sum + row.poorCalls, 0),
    locatedCalls: selectedRows.reduce((sum, row) => sum + row.locatedCalls, 0),
    unlocatedCalls: selectedRows.reduce((sum, row) => sum + row.unlocatedCalls, 0),
  };
}

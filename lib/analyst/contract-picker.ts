import type { AnalystDataset, SourceCustomer } from './types';
export interface ContractRow {
  customer: SourceCustomer;
  sampleCount: number;
  callCount: number | undefined;
  gnssSampleCount: number | undefined;
}
/** Manifest metadata only: never load customer partitions to browse contracts. */
export function contractPage(
  dataset: AnalystDataset,
  date: string,
  query: string,
  missingGnss: boolean,
  requestedPage: number,
  pageSize: 25 | 50,
) {
  const needle = query.trim().toLowerCase();
  const customers = new Map(
    dataset.customers.map((customer) => [customer.id, customer]),
  );
  const rows: ContractRow[] = [];
  for (const day of dataset.days) {
    const customer = customers.get(day.customerId);
    if (
      day.date !== date ||
      !customer ||
      (missingGnss && day.gnssSampleCount !== 0)
    )
      continue;
    if (
      needle &&
      ![
        customer.sourceContractId,
        customer.displayName,
        customer.maskedPhone,
      ].some((value) => value?.toLowerCase().includes(needle))
    )
      continue;
    rows.push({
      customer,
      sampleCount: day.sampleCount,
      callCount: day.callCount,
      gnssSampleCount: day.gnssSampleCount,
    });
  }
  rows.sort(
    (a, b) =>
      Number(b.customer.sourceContractId?.toLowerCase() === needle) -
        Number(a.customer.sourceContractId?.toLowerCase() === needle) ||
      (a.customer.sourceContractId ?? a.customer.displayName).localeCompare(
        b.customer.sourceContractId ?? b.customer.displayName,
      ),
  );
  const pages = Math.ceil(rows.length / pageSize);
  const page = Math.max(
    0,
    Math.min(
      Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0,
      Math.max(0, pages - 1),
    ),
  );
  return {
    rows: rows.slice(page * pageSize, (page + 1) * pageSize),
    total: rows.length,
    page,
    pages,
  };
}

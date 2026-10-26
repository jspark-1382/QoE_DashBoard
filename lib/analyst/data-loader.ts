import { normalizeDay } from './data';
import { buildOverview } from './overview';
import type {
  AnalystDataset,
  AnalystDay,
  AnalystOverview,
  AnalystSource,
  SourceDay,
} from './types';
const sourcePath = (source: AnalystSource) =>
  source === 'MDT' ? 'MDT' : 'measured';
async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`자료를 불러오지 못했습니다 (${response.status}): ${url}`);
  return response.json();
}
export function loadDataset(
  source: AnalystSource,
  signal?: AbortSignal,
): Promise<AnalystDataset> {
  return json(
    `/qoe/${source === 'MDT' ? 'mdt-data' : 'executive-data'}.json`,
    signal,
  );
}
export async function loadDay(
  dataset: AnalystDataset,
  entry: SourceDay,
  source: AnalystSource,
  signal?: AbortSignal,
): Promise<AnalystDay> {
  signal?.throwIfAborted();
  const detail = entry.dataPath
    ? await json<SourceDay>(
        `/qoe/${entry.dataPath.replace(/^\/+/, '')}`,
        signal,
      )
    : entry;
  signal?.throwIfAborted();
  if (detail.customerId !== entry.customerId || detail.date !== entry.date)
    throw new Error('계약 상세의 대상 또는 일자가 일치하지 않습니다.');
  return normalizeDay(dataset, detail, source);
}
export async function loadOverview(
  dataset: AnalystDataset,
  source: AnalystSource,
  date: string,
  signal?: AbortSignal,
): Promise<AnalystOverview> {
  signal?.throwIfAborted();
  // Legacy inline sources have no content revision, so a saved summary cannot be
  // proven current after source regeneration. Their small call list is already loaded.
  if (
    !dataset.meta.revision &&
    !dataset.meta.partitioned &&
    !dataset.days.some((day) => day.dataPath)
  )
    return buildOverview(dataset, dataset.days, source, date);
  let overview: AnalystOverview;
  try {
    overview = await json<AnalystOverview>(
      `/qoe/analyst-overview/${sourcePath(source)}/${date}.json`,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!dataset.meta.partitioned && !dataset.days.some((d) => d.dataPath))
      return buildOverview(dataset, dataset.days, source, date);
    throw new Error(
      '일자별 품질 현황 자료가 없습니다. node scripts/build-analyst-overview.cjs 명령으로 자료를 갱신해 주세요.',
    );
  }
  signal?.throwIfAborted();
  if (
    overview.schemaVersion !== 'analyst-overview-v1' ||
    overview.analyticsVersion !== 'overview-analytics-v1' ||
    overview.source !== source ||
    overview.date !== date ||
    overview.sourceRevision !== dataset.meta.revision
  )
    throw new Error(
      '품질 현황 자료와 원본 버전이 일치하지 않습니다. node scripts/build-analyst-overview.cjs 명령으로 갱신해 주세요.',
    );
  return overview;
}

import { normalizeDay } from './data';
import {deriveCallQoe} from './derived-qoe';
import { buildOverview } from './overview';
import { SharedRequestCache } from './request-cache';
import type {
  AnalystDataset,
  AnalystDay,
  AnalystOverview,
  AnalystSource,
  SourceDay,
} from './types';
const sourcePath = (source: AnalystSource) =>
  source === 'MDT' ? 'MDT' : 'measured';
// Public manifests are mutable URLs. Revalidate again after a short interaction
// window; retain only bounded completed results, never failed/aborted responses.
const CACHE_AGE_MS = 30_000;
const datasets = new SharedRequestCache<AnalystDataset>(2, CACHE_AGE_MS);
const overviews = new SharedRequestCache<AnalystOverview>(5, CACHE_AGE_MS);
const details = new WeakMap<AnalystDataset, SharedRequestCache<AnalystDay>>();
async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  // Revalidate public JSON: an earlier interrupted deployment left zero-filled
  // responses cacheable for an hour. Never reuse stale broken detail/MDT data.
  const response = await fetch(url, { signal, cache: 'no-cache' });
  if (!response.ok)
    throw new Error(`자료를 불러오지 못했습니다 (${response.status}): ${url}`);
  return response.json();
}
export function loadDataset(
  source: AnalystSource,
  signal?: AbortSignal,
): Promise<AnalystDataset> {
  const url = `/qoe/${source === 'MDT' ? 'voice-1030' : 'executive-data'}.json`;
  return datasets.get(url, async requestSignal => {
    const value = await json<AnalystDataset>(url, requestSignal);
    if (!value?.meta || !Array.isArray(value.meta.dates) ||
        !Array.isArray(value.customers) || !Array.isArray(value.days))
      throw new Error('분석 목록 자료의 형식이 올바르지 않습니다.');
    return value;
  }, signal);
}
export async function loadDay(
  dataset: AnalystDataset,
  entry: SourceDay,
  source: AnalystSource,
  signal?: AbortSignal,
): Promise<AnalystDay> {
  if (dataset.meta.revision && entry.dataPath) {
    let cache = details.get(dataset);
    if (!cache) {
      cache = new SharedRequestCache<AnalystDay>(8, CACHE_AGE_MS);
      details.set(dataset, cache);
    }
    const key = JSON.stringify([source, dataset.meta.revision, entry.dataPath, entry.customerId, entry.date]);
    return cache.get(key, requestSignal => readDay(dataset, entry, source, requestSignal), signal);
  }
  return readDay(dataset, entry, source, signal);
}
async function readDay(
  dataset: AnalystDataset, entry: SourceDay, source: AnalystSource, signal?: AbortSignal,
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
    throw new Error('고객 상세의 대상 또는 일자가 일치하지 않습니다.');
  return normalizeDay(dataset, detail, source);
}
export async function loadOverview(
  dataset: AnalystDataset,
  source: AnalystSource,
  date: string,
  signal?: AbortSignal,
): Promise<AnalystOverview> {
  // Inline/fallback summaries may be rebuilt from mutable in-memory records.
  // Cache only externally partitioned sources whose response revision is checked.
  if (dataset.meta.revision &&
      (dataset.meta.partitioned || dataset.days.some(day => day.dataPath))) {
    const key = JSON.stringify([source, dataset.meta.revision, date]);
    return overviews.get(key, requestSignal => readOverview(dataset, source, date, requestSignal), signal);
  }
  return readOverview(dataset, source, date, signal);
}
async function readOverview(
  dataset: AnalystDataset, source: AnalystSource, date: string, signal?: AbortSignal,
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
  if(source==='MDT'&&dataset.meta.qoeBasis==='rtcp-mos-v5')
    return {...overview,calls:overview.calls.map(c=>({...c,qoe:deriveCallQoe(c.mos,c.sipCause)}))};
  return overview;
}

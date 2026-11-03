'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from './document-link';
import { loadDataset, loadOverview } from '../../lib/analyst/data-loader';
import { compareMosCandidate, type MosComparison } from '../../lib/mos/comparison';
import { mosGrade } from '../../lib/mos/call-evidence';
import type { AnalystOverview } from '../../lib/analyst/types';
import styles from './mos-lab.module.css';

type LoadState = { overview: AnalystOverview | null; loading: boolean; error: string | null };
const pretty = (value: number) => value.toLocaleString('ko-KR');
const point = (value: number | null) => value == null ? '—' : value.toFixed(3);
const gradeNames = { POOR: '불량', WARNING: '주의', GOOD: '양호' };
const gradeOrder = ['POOR', 'WARNING', 'GOOD'] as const;

export function MosLab() {
  const [data, setData] = useState<LoadState>({ overview: null, loading: true, error: null });
  const [comparison, setComparison] = useState<MosComparison | null>(null);
  const [fileName, setFileName] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const dataset = await loadDataset('MDT', controller.signal);
        if (dataset.meta.qoeBasis !== 'rtcp-mos-v5') throw Error('원본 데이터는 10월 30일 RTCP MOS(v5) 형식이어야 합니다.');
        const date = '2026-10-30';
        if (!dataset.meta.dates.includes(date)) throw Error('10월 30일 원본이 없습니다.');
        const overview = await loadOverview(dataset, 'MDT', date, controller.signal);
        if (!controller.signal.aborted) setData({ overview, loading: false, error: null });
      } catch (reason) {
        if (!controller.signal.aborted) {
          setData({ overview: null, loading: false, error: reason instanceof Error ? reason.message : '원본 로딩 오류' });
        }
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const baseline = useMemo(() => {
    if (!data.overview) return null;
    const totals = { POOR: 0, WARNING: 0, GOOD: 0, UNAVAILABLE: 0 };
    for (const call of data.overview.calls) totals[mosGrade(call.mos)]++;
    return totals;
  }, [data.overview]);

  const downloadTemplate = useCallback(() => {
    const overview = data.overview;
    if (!overview?.sourceRevision) return;
    // Empty values are intentional: users must supply real algorithm outputs.
    const recordIds = overview.calls.filter((call) => mosGrade(call.mos) !== 'UNAVAILABLE')
      .slice(0, 20).map((call) => ({ callId: call.rawCallId ?? call.id, mosImproved: null }));
    const content = {
      algorithmVersion: 'candidate-v1',
      sourceRevision: overview.sourceRevision,
      date: overview.date,
      records: recordIds,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'mos-improved-template-1030.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Release the temporary object URL after the synchronous download activation.
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [data.overview]);

  const onUpload = useCallback(async (file?: File) => {
    setComparison(null);
    setFileName(file?.name ?? '');
    setUploadError(null);
    if (!file) return;
    if (!data.overview) {
      setUploadError('원본 MOS 데이터가 로딩되지 않았습니다.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setUploadError('파일은 12MB 이하 JSON이어야 합니다.');
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = compareMosCandidate(parsed, data.overview);
      setComparison(result);
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : '모델 결과 파일 파싱 오류');
    }
  }, [data.overview]);

  const totals = baseline;
  const denominator = totals ? totals.POOR + totals.WARNING + totals.GOOD : 0;
  const candidateTotal = comparison?.paired ?? 0;
  const maxGrade = comparison ? Math.max(1, ...gradeOrder.map((grade) =>
    Math.max(comparison.gradeOriginal[grade], comparison.gradeCandidate[grade]))) : 1;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href="/?source=MDT&view=overview" className={styles.back}>← MOS 품질 현황</Link>
          <h1>MOS 알고리즘 비교 연구실</h1>
          <p>원본 RTCP MOS(v5)를 보존하면서 개선 모델의 산출물을 동일 통화 기준으로 비교합니다.</p>
        </div>
        <div className={styles.status}>10월 30일 기준 · 모델 검증 준비</div>
      </header>

      {data.loading && <output className={styles.notice}>원본 MOS 데이터를 불러오는 중입니다…</output>}
      {data.error && <div className={styles.error} role="alert">원본 자료를 확인할 수 없습니다: {data.error}</div>}

      {totals && (
        <>
          <section aria-label="원본 MOS v5 기준선" className={styles.baseline}>
            <div className={styles.sectionHeading}>
              <div><h2>원본 MOS(v5) 기준선</h2><p>비교 전에는 원본만 표시하며 개선 모델의 가상 점수를 생성하지 않습니다.</p></div>
              <span className={styles.revision}>원본 버전 {data.overview?.sourceRevision?.slice(0, 10)}</span>
            </div>
            <div className={styles.statGrid}>
              <div className={styles.stat}><span>전체 통화</span><strong>{pretty(data.overview!.calls.length)}</strong><small>원본 CDR</small></div>
              <div className={styles.stat}><span>유효 MOS</span><strong>{pretty(denominator)}</strong><small>평가 분모</small></div>
              <div className={styles.stat}><span>불량</span><strong className={styles.red}>{pretty(totals.POOR)}</strong><small>MOS &lt; 3.0</small></div>
              <div className={styles.stat}><span>주의</span><strong className={styles.amber}>{pretty(totals.WARNING)}</strong><small>3.0 ≤ MOS &lt; 3.5</small></div>
              <div className={styles.stat}><span>양호</span><strong className={styles.green}>{pretty(totals.GOOD)}</strong><small>MOS ≥ 3.5</small></div>
              <div className={styles.stat}><span>미평가</span><strong>{pretty(totals.UNAVAILABLE)}</strong><small>등급 계산 제외</small></div>
            </div>
          </section>

          <section className={styles.uploadPanel} aria-label="MOS 개선 모델 결과 업로드">
            <div className={styles.sectionHeading}>
              <div><h2>개선 MOS 결과 연결</h2><p>모델 학습·실행은 별도 단계입니다. 이 화면에서는 모델이 생성한 JSON을 읽어 비교합니다.</p></div>
              <button type="button" onClick={downloadTemplate} className={styles.secondary}>JSON 입력 양식 받기 (20개 통화)</button>
            </div>
            <div className={styles.workflow}>
              <span>① 원본 v5</span><span aria-hidden="true">→</span><span>② 개선 모델 결과 파일</span><span aria-hidden="true">→</span><span>③ 동일 통화 비교</span>
            </div>
            <div className={styles.uploadRow}>
              <input
                ref={fileRef}
                aria-label="개선 MOS JSON 파일"
                type="file"
                accept=".json,application/json"
                onChange={(event) => void onUpload(event.target.files?.[0])}
              />
              {comparison && <button className={styles.secondary} type="button" onClick={() => {
                setComparison(null); setFileName(''); setUploadError(null);
                if (fileRef.current) fileRef.current.value = '';
              }}>비교 결과 초기화</button>}
            </div>
            <p className={styles.hint}>JSON 필수 속성: <code>algorithmVersion</code>, <code>sourceRevision</code>, <code>date</code>, <code>records: [&#123;callId, mosImproved&#125;]</code>. 개선 MOS는 1~5 또는 null이어야 합니다. 입력 양식의 null을 실제 모델 결과로 바꿔 넣으세요.</p>
            <p className={styles.hint}>파일은 브라우저 내에서 비교하며 서버로 업로드하지 않습니다. 통화 ID·원본 버전이 맞지 않거나 중복된 결과는 검증에서 제외 또는 거부합니다.</p>
            {fileName && <p className={styles.fileName}>선택 파일: {fileName}</p>}
            {uploadError && <p role="alert" className={styles.error}>{uploadError}</p>}
            {!comparison && !uploadError && <div className={styles.empty}>
              <strong>등록된 개선 MOS 모델 결과 없음</strong>
              <p>원본 v5가 현재 기준입니다. 실제 모델 출력을 업로드하면 등급별 변화와 통화별 차이를 분석합니다.</p>
            </div>}
          </section>

          {comparison && (
            <>
              <section className={styles.baseline} aria-label="개선 MOS 비교 결과">
                <div className={styles.sectionHeading}>
                  <div><h2>모델 비교 · {comparison.algorithmVersion}</h2><p>동일 통화 {pretty(candidateTotal)}건의 원본 MOS와 후보 MOS를 대조했습니다.</p></div>
                  <span className={styles.revision}>모델 결과 연동</span>
                </div>
                <div className={styles.statGrid}>
                  <div className={styles.stat}><span>제출 결과</span><strong>{pretty(comparison.submittedRows)}</strong><small>업로드 JSON</small></div>
                  <div className={styles.stat}><span>비교 가능 쌍</span><strong>{pretty(candidateTotal)}</strong><small>유효 원본 + 개선값</small></div>
                  <div className={styles.stat}><span>원본 평균</span><strong>{point(comparison.meanOriginal)}</strong><small>동일 표본 기준</small></div>
                  <div className={styles.stat}><span>후보 평균</span><strong>{point(comparison.meanCandidate)}</strong><small>동일 표본 기준</small></div>
                  <div className={styles.stat}><span>평균값 차이</span><strong>{comparison.meanDifference == null ? '—' : (comparison.meanDifference >= 0 ? '+' : '') + comparison.meanDifference.toFixed(3)}</strong><small>후보 - 원본</small></div>
                  <div className={styles.stat}><span>등급 변화</span><strong>{pretty(comparison.shiftedUp + comparison.shiftedDown)}</strong><small>상향 {comparison.shiftedUp} · 하향 {comparison.shiftedDown}</small></div>
                </div>
                <p className={styles.hint}>
                  연결 ID {pretty(comparison.matchedIds)}건 · 미확인 ID {pretty(comparison.unknownIds)}건 · 원본 미평가 {pretty(comparison.unscoredOriginal)}건 · 개선값 미제공 {pretty(comparison.missingCandidate)}건 · 등급 유지 {pretty(comparison.unchanged)}건
                </p>
                {candidateTotal === 0 ? <div className={styles.empty}>유효한 MOS 쌍이 없어 비교 통계를 산출할 수 없습니다.</div> : <>
                  <h3 className={styles.subheading}>동일 통화 기준 품질등급 분포</h3>
                  <div className={styles.legend}><span><i className={styles.originalDot} />원본 v5</span><span><i className={styles.improvedDot} />개선 후보</span></div>
                  <div className={styles.gradeChart}>
                    {gradeOrder.map((grade) => (
                      <div className={styles.gradeRow} key={grade}>
                        <strong>{gradeNames[grade]}</strong>
                        <div className={styles.bars}>
                          <div className={styles.barTrack}><div className={styles.originalBar} style={{width: Math.max(1,100*comparison.gradeOriginal[grade]/maxGrade)+'%'}} /><span>{pretty(comparison.gradeOriginal[grade])}</span></div>
                          <div className={styles.barTrack}><div className={styles.improvedBar} style={{width: Math.max(1,100*comparison.gradeCandidate[grade]/maxGrade)+'%'}} /><span>{pretty(comparison.gradeCandidate[grade])}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <h3 className={styles.subheading}>MOS 값 차이가 큰 통화 (상위 20개)</h3>
                  <div className={styles.tableScroll}><table><thead><tr><th>통화 ID</th><th>원본 v5</th><th>개선 후보</th><th>값 차이</th><th>등급 변화</th></tr></thead><tbody>
                    {comparison.greatestDifferences.map((row) => (
                      <tr key={row.callId}><td title={row.callId}>{row.callId.slice(0, 18)}…</td><td>{point(row.original)}</td><td>{point(row.candidate)}</td>
                        <td>{row.delta >= 0 ? '+' : ''}{row.delta.toFixed(3)}</td>
                        <td>{gradeNames[row.originalGrade as keyof typeof gradeNames]} → {gradeNames[row.candidateGrade as keyof typeof gradeNames]}</td></tr>
                    ))}
                  </tbody></table></div>
                </>}
              </section>
              <aside className={styles.caution}>MOS가 높아졌다는 사실만으로 사용자 체감 음성품질의 실질적인 개선이나 정확도 향상을 입증할 수 없습니다. 독립적인 음성 녹음·주관평가 또는 검증 레이블로 모델을 검증해야 합니다.</aside>
            </>
          )}
        </>
      )}
    </main>
  );
}

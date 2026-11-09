'use client';

import type { OverviewAnalytics, ScoreBand } from '../../lib/analyst/overview-analytics';
import styles from './mos-summary-strip.module.css';

interface Props {
  analytics: OverviewAnalytics;
  selectedBand: ScoreBand | null;
  onSelectBand: (band: ScoreBand | null) => void;
}
const number = (value: number) => value.toLocaleString('ko-KR');
const pct = (value: number, total: number) =>
  total ? (100 * value / total).toFixed(2) + '%' : '—';

const grades: {id: ScoreBand; range: string}[] = [
  { id: 'poor', range: '3.0 미만' },
  { id: 'fair', range: '3.0 이상 · 3.5 미만' },
  { id: 'good', range: '3.5 이상' },
];

export function MosSummaryStrip({ analytics, selectedBand, onSelectBand }: Props) {
  const missingRate = pct(analytics.unscored, analytics.total);
  return (
    <section className={styles.panel} aria-label="QoE 품질 등급별 종합 현황">
      <div className={styles.heading}>
        <div>
          <h2>RTCP QoE(v5) 품질등급</h2>
          <p>10월 30일 SIP CDR · 원본 QoE 기준, 등급을 누르면 해당 통화로 필터링됩니다.</p>
        </div>
        <span className={styles.source}>원본 v5 · 고정 기준 3.0 / 3.5</span>
      </div>
      <div className={styles.grid}>
        {grades.map(({id, range}) => {
          const band = analytics.bands.find((x) => x.id === id)!;
          return (
            <button
              key={id}
              type="button"
              data-band={id}
              aria-pressed={selectedBand === id}
              className={styles.grade}
              disabled={band.count === 0}
              onClick={() => onSelectBand(selectedBand === id ? null : id)}
            >
              <span className={styles.name}>
                <i className={styles.dot} style={{backgroundColor:band.color}} aria-hidden="true" />
                {band.label}<small>{range}</small>
              </span>
              <strong>{number(band.count)}<span> 통화</span></strong>
              <span className={styles.percent}>평가 가능 통화 대비 {pct(band.count, analytics.evaluated)}</span>
            </button>
          );
        })}
        <div className={styles.missing}>
          <span className={styles.name}><i className={styles.dot} aria-hidden="true" />미평가<small>QoE ‘_’ / 누락</small></span>
          <strong>{number(analytics.unscored)}<span> 통화</span></strong>
          <span className={styles.percent}>전체 통화 대비 {missingRate}</span>
        </div>
      </div>
      <p className={styles.footnote}>
        불량률·주의율의 분모는 유효 QoE {number(analytics.evaluated)}건입니다.
        미평가 {number(analytics.unscored)}건은 불량·양호로 간주하지 않습니다.
      </p>
    </section>
  );
}

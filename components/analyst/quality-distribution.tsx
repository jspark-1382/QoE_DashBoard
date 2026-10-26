'use client';

import type {
  OverviewAnalytics,
  ScoreBand,
} from '../../lib/analyst/overview-analytics';
import styles from './quality-distribution.module.css';

interface Props {
  analytics: OverviewAnalytics;
  selectedBand: ScoreBand | null;
  onBandSelect: (band: ScoreBand | null) => void;
}
const count = (value: number) => value.toLocaleString('ko-KR');
const percent = (value: number | null) =>
  value === null ? '—' : `${value.toFixed(1)}%`;

export function QualityDistribution({
  analytics,
  selectedBand,
  onBandSelect,
}: Props) {
  const metricLabel = analytics.metric === 'mos' ? 'MOS' : 'QoE';
  const maximum = Math.max(1, ...analytics.bins.map((bin) => bin.count));
  const select = (band: ScoreBand) =>
    onBandSelect(selectedBand === band ? null : band);
  const rangeLabel = (band: ScoreBand) =>
    analytics.metric === 'mos'
      ? band === 'good'
        ? '4.0 이상'
        : band === 'fair'
          ? '3.5 이상 4.0 미만'
          : '3.5 미만'
      : band === 'good'
        ? `${analytics.threshold} 이상`
        : `${analytics.threshold} 미만`;

  return (
    <section className={styles.panel} aria-label={`${metricLabel} 점수 분포`}>
      <header className={styles.heading}>
        <h3>{metricLabel} 점수 분포</h3>
        <span>평가 {count(analytics.evaluated)}통화</span>
      </header>
      {analytics.evaluated === 0 ? (
        <div className={styles.empty}>평가 가능한 통화 없음</div>
      ) : (
        <div
          className={styles.composition}
          aria-label="평가 통화의 구간별 구성비"
        >
          {analytics.bands.map((band) => (
            <button
              key={band.id}
              type="button"
              className={styles.segment}
              data-composition-band={band.id}
              style={{
                width: `${band.percent ?? 0}%`,
                backgroundColor: band.color,
              }}
              aria-label={`${band.label} ${rangeLabel(band.id)}, ${count(band.count)}통화, ${percent(band.percent)}`}
              aria-pressed={selectedBand === band.id}
              disabled={band.count === 0}
              title={`${band.label} (${rangeLabel(band.id)}) · ${count(band.count)}통화 · ${percent(band.percent)}`}
              onClick={() => select(band.id)}
            >
              {(band.percent ?? 0) >= 16 && (
                <span>
                  {band.label}
                  <small>
                    {analytics.metric === 'mos' && band.id === 'fair'
                      ? '3.5–4.0'
                      : rangeLabel(band.id)}
                  </small>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className={styles.legend}>
        {analytics.bands.map((band) => (
          <button
            key={band.id}
            type="button"
            className={styles.legendButton}
            aria-pressed={selectedBand === band.id}
            disabled={band.count === 0}
            title={`${rangeLabel(band.id)} · ${count(band.count)}통화`}
            onClick={() => select(band.id)}
          >
            <i style={{ backgroundColor: band.color }} aria-hidden="true" />
            {band.label} <strong>{percent(band.percent)}</strong>
          </button>
        ))}
      </div>
      <div
        className={styles.histogram}
        aria-label={`${metricLabel} 0부터 5까지 0.25점 간격 통화 수`}
      >
        <div className={styles.yAxis} aria-hidden="true">
          <span>{count(maximum)}</span>
          <span>{count(Math.round(maximum / 2))}</span>
          <span>0</span>
        </div>
        <div className={styles.plot}>
          <div className={styles.grid} aria-hidden="true" />
          <div className={styles.columns}>
            {analytics.bins.map((bin) => {
              const band = analytics.bands.find((item) => item.id === bin.band);
              const interval = `${bin.from.toFixed(2)} 이상 ${bin.to.toFixed(2)}${bin.to === 5 ? ' 이하' : ' 미만'}`;
              const description = `${metricLabel} ${interval}, ${count(bin.count)}통화, ${band?.label ?? ''}`;
              const height = (bin.count / maximum) * 82;
              return (
                <button
                  key={bin.from}
                  type="button"
                  data-bin-from={bin.from}
                  className={styles.column}
                  aria-label={description}
                  title={description}
                  aria-pressed={selectedBand === bin.band}
                  disabled={bin.count === 0}
                  onClick={() => select(bin.band)}
                >
                  <svg
                    viewBox="0 0 20 82"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="1"
                      y={82 - height}
                      width="18"
                      height={height}
                      fill={bin.color}
                    />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
        <div className={styles.xAxis} aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <span key={value}>{value}</span>
          ))}
        </div>
      </div>
      <footer className={styles.footnote}>
        <span>
          미평가 {count(analytics.unscored)}통화
          {analytics.outOfRange > 0
            ? ` · 범위 밖 ${count(analytics.outOfRange)}통화`
            : ''}
        </span>
        <span>구간 선택 → 조사</span>
      </footer>
    </section>
  );
}

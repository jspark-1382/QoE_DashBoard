'use client';
import React from 'react';
import type {
  AnalystCall,
  AnalystSample,
  AnalystSource,
} from '../../lib/analyst/types';
import styles from './contract-workspace.module.css';
const labels = {
  gnss: 'GNSS 관측',
  interpolated: '보간',
  radio: '무선 추정',
  station: '위치 근거 없음 (기지국 좌표만 제공)',
  measured: '실측',
  unavailable: '위치 근거 없음',
};
const value = (n: number | null | undefined, unit = '') =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '미제공'
    : `${n}${unit}`;
export function ObservationDetails({
  sample,
  call,
  samples,
  source,
}: {
  sample: AnalystSample | null;
  call: AnalystCall | null;
  samples: AnalystSample[];
  source: AnalystSource;
}) {
  const rsrp = samples.filter((s) => s.rsrp !== null),
    sinr = samples.filter((s) => s.sinr !== null),
    both = samples.filter((s) => s.rsrp !== null && s.sinr !== null);
  return (
    <div className={styles.observation}>
      <h3>선택 관측 근거</h3>
      {sample ? (
        <>
          <div className={styles.observationTime}>{sample.time}</div>
          <p className={styles.locationLabel}>
            {labels[sample.locationSource]}
          </p>
          <p className={styles.helper}>
            원본 관측 #{sample.index} · {source}
          </p>
          <dl className={styles.detailList}>
            <dt>RSRP</dt>
            <dd>{value(sample.rsrp, ' dBm')}</dd>
            <dt>RSRQ</dt>
            <dd>{value(sample.rsrq, ' dB')}</dd>
            <dt>SINR</dt>
            <dd>{value(sample.sinr, ' dB')}</dd>
            {source === '실측' && sample.mos !== null && (
              <>
                <dt>MOS</dt>
                <dd>{value(sample.mos)}</dd>
              </>
            )}
          </dl>
          <details className={styles.raw}>
            <summary>위치 근거</summary>
            <dl className={styles.detailList}>
              <dt>위도 / 경도</dt>
              <dd>
                {sample.locationSource === 'station'
                  ? '고객 위치 미제공'
                  : sample.lat !== null && sample.lon !== null
                    ? `${sample.lat.toFixed(6)} / ${sample.lon.toFixed(6)}`
                    : '미제공'}
              </dd>
              <dt>
                {sample.locationSource === 'radio' ||
                sample.locationSource === 'interpolated'
                  ? '모델 불확실성 추정'
                  : '위치 정확도'}
              </dt>
              <dd>
                {sample.locationSource === 'gnss'
                  ? '정확도 정보 없음'
                  : value(sample.accuracyM, ' m')}
              </dd>
              {sample.locationSource === 'gnss' && (
                <>
                  <dt>GNSS 원본 좌표</dt>
                  <dd>
                    {sample.gnssCrs || '좌표계 미제공'}
                    <br />X {value(sample.gnssX)} / Y {value(sample.gnssY)}
                  </dd>
                </>
              )}
            </dl>
          </details>
          <details className={styles.raw}>
            <summary>기지국·망 정보</summary>
            <dl className={styles.detailList}>
              <dt>PCI</dt>
              <dd>{value(sample.pci)}</dd>
              <dt>Cell ID</dt>
              <dd>{sample.cellId || '미제공'}</dd>
              <dt>기지국 ID</dt>
              <dd>{sample.baseStationId || '미제공'}</dd>
              <dt>주파수 (원본)</dt>
              <dd>{value(sample.frequency)}</dd>
              <dt>망 / 사이트</dt>
              <dd>
                {sample.rat || '미제공'} / {sample.site || '미제공'}
              </dd>
            </dl>
          </details>
          <details className={styles.raw}>
            <summary>원본 관측 행 보기</summary>
            <p>
              원본 계약번호: {call?.contractId || '미제공'} · 관측 CI:{' '}
              {sample.ci || '미제공'}
            </p>
            <p>
              원본 UTMK: X {value(sample.gnssX)} / Y {value(sample.gnssY)}
            </p>
            <pre>{JSON.stringify(sample.raw, null, 2)}</pre>
          </details>
        </>
      ) : (
        <p className={styles.empty}>이 통화에 관측 이벤트가 없습니다.</p>
      )}
      <details className={styles.raw}>
        <summary>원본·종료 코드</summary>
        <h4>통화 종료 코드</h4>
        <dl className={styles.detailList}>
          {(
            [
              ['종료 유형', call?.endType],
              ['SIP', call?.sipCause],
              ['Q.850', call?.q850Cause],
              ['FC', call?.fc],
            ] as const
          ).map(([key, v]) => (
            <React.Fragment key={key}>
              <dt>{key}</dt>
              <dd>{v || '미제공'}</dd>
            </React.Fragment>
          ))}
        </dl>
      </details>
      <h4>관측 조건 · 선택 통화</h4>
      <ul className={styles.evidence}>
        <li>
          RSRP −105 dBm 미만{' '}
          <b>
            {rsrp.filter((s) => s.rsrp! < -105).length}/{rsrp.length}건
          </b>
        </li>
        <li>
          SINR 0 dB 미만{' '}
          <b>
            {sinr.filter((s) => s.sinr! < 0).length}/{sinr.length}건
          </b>
        </li>
        <li>
          두 조건 동시 발생{' '}
          <b>
            {both.filter((s) => s.rsrp! < -105 && s.sinr! < 0).length}/
            {both.length}건
          </b>
        </li>
      </ul>
      <p className={styles.helper}>
        분모는 해당 무선값이 있는 이벤트입니다. 조건 건수는 원인 판정이
        아닙니다.
      </p>
      <p className={styles.helper}>
        QoE는 원본 통화 단위 값입니다. 시점별 무선값과 별도로 표시합니다.
      </p>
    </div>
  );
}

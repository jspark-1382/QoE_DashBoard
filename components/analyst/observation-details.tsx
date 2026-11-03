'use client';
import React from 'react';
import type {
  AnalystCall,
  AnalystSample,
  AnalystSource,
} from '../../lib/analyst/types';
import {
  estimationMethodLabel,
  estimationReason,
} from '../../lib/analyst/estimation-evidence';
import styles from './observation-details.module.css';
const labels = {
  gnss: 'GNSS 관측',
  interpolated: '보간 추정',
  radio: '무선 추정',
  station: '위치 근거 없음 (기지국 좌표만 제공)',
  measured: '제공 좌표 (실측)',
  unavailable: '위치 근거 없음',
};
const value = (n: number | null | undefined, unit = '') =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '미제공'
    : `${n}${unit}`;
const modelValue = (n: number | null | undefined, unit = '', digits = 1) =>
  n == null || !Number.isFinite(n)
    ? '미제공'
    : `${Number(n.toFixed(digits))}${unit}`;
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
  const conditions = [
    {
      label: 'RSRP −105 dBm 미만',
      count: rsrp.filter((s) => s.rsrp! < -105).length,
      total: rsrp.length,
    },
    {
      label: 'SINR 0 dB 미만',
      count: sinr.filter((s) => s.sinr! < 0).length,
      total: sinr.length,
    },
    {
      label: '두 조건 동시 발생',
      count: both.filter((s) => s.rsrp! < -105 && s.sinr! < 0).length,
      total: both.length,
    },
  ];
  return (
    <div className={styles.observation}>
      <h3>선택 관측 근거</h3>
      {sample ? (
        <>
          <div className={styles.observationTime}>{sample.time}</div>
          <p className={styles.locationLabel}>
            {labels[sample.locationSource]}
          </p>
          <div className={styles.sourceIdentity} data-location-source={sample.locationSource}>
            <b>{['gnss','measured'].includes(sample.locationSource)
              ? 'GNSS / 실측 관측 위치'
              : ['radio','interpolated'].includes(sample.locationSource)
                ? sample.lat!=null&&sample.lon!=null
                  ? sample.locationSource==='radio'?'고객 추정 위치 · 무선 측량':'고객 추정 위치 · 보간'
                  : '고객 위치 계산 불가 · 무선 근거만'
                : '고객 위치 미확인 · 기지국은 별개'}</b>
            <span>{['radio','interpolated'].includes(sample.locationSource)
              ? 'GNSS 좌표가 아니며 계산 정확도가 검증되지 않았습니다.'
              : ['gnss','measured'].includes(sample.locationSource)
                ? '제공된 관측 좌표입니다. 측정 오차는 미제공입니다.'
                : '이 관측값만으로 고객의 실제 위치를 확정할 수 없습니다.'}</span>
          </div>
          {sample.gnssReference&&<div className={styles.gnssReferenceEvidence}
              aria-label="선택 관측의 이전 GNSS 기준">
              <strong>이전 GNSS 기준점 확인됨</strong>
              <p>관측 시각보다 {sample.gnssReference.ageSeconds.toFixed(1)}초 전 GNSS가 존재합니다.
                이동 가능 범위 반경 약 {sample.gnssReference.movementRadiusM.toLocaleString()}m
                (속도 120km/h·기본 GNSS 오차 250m 가정).</p>
              <span>이는 이전 실측 위치를 참고하는 영역이며, 현재 관측 시점의 새 GNSS 좌표가 아닙니다.</span>
            </div>}
          {sample.estimation?.review&&!sample.estimation.review.accepted&&sample.lat==null&&
            <output className={styles.positionReviewWarning} aria-label="추정 위치 품질검토 결과">
              <strong>고객 위치 추정 보류 · 지도 좌표 미표시</strong>
              <p>{sample.estimation.review.reasons.join(' · ')}</p>
              <span>모델 신뢰 점수 {sample.confidence??'미확인'}점과 별개로 좌표 품질 심사에서 제외됐습니다.
                {sample.estimation.review.cappedSites>0
                  ? ' 거리 상한 도달 '+sample.estimation.review.cappedSites+'/'+sample.estimation.siteCount+'사이트.'
                  : ''}
                {' '}실제 고객 위치는 확인되지 않았습니다.</span>
            </output>}
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
            <dt>PCI</dt>
            <dd>{value(sample.pci)}</dd>
            <dt>Cell ID</dt>
            <dd>{sample.cellId || '미제공'}</dd>
            <dt>기지국 ID</dt>
            <dd>{sample.baseStationId || '미제공'}</dd>
            {source === '실측' && sample.mos !== null && (
              <>
                <dt>MOS</dt>
                <dd>{value(sample.mos)}</dd>
              </>
            )}
          </dl>
        </>
      ) : (
        <p className={styles.empty}>이 통화에 관측 이벤트가 없습니다.</p>
      )}
      <section className={styles.conditions} aria-label="관측 조건 · 선택 통화">
        <h4>관측 조건 · 선택 통화</h4>
        <ul className={styles.conditionList}>
          {conditions.map(({ label, count, total }) => (
            <li key={label}>
              <span>{label}</span>
              <b>
                {count}/{total}건
              </b>
              {total > 0 ? (
                <progress
                  aria-label={`${label} 관측 비율`}
                  value={count}
                  max={total}
                />
              ) : (
                <span className={styles.noEvidence}>관측값 없음</span>
              )}
            </li>
          ))}
        </ul>
      </section>
      {sample && (
        <>
          {source === 'MDT' && (
            <details
              className={styles.estimationStatus}
              aria-label="선택 관측 위치 추정 근거"
            >
              <summary>자동 위치 추정 근거</summary>
              <p>{estimationReason(sample)}</p>
              {sample.estimation && (
                <>
                  <dl className={styles.detailList}>
                    <dt>실제 방법</dt>
                    <dd>{estimationMethodLabel(sample.estimation.method)}</dd>
                    <dt>사용 기지국 위치 / 시간창</dt>
                    <dd>
                      {sample.estimation.siteCount}개 /{' '}
                      {sample.estimation.windowSec}초
                    </dd>
                    <dt>거리 모델 잔차</dt>
                    <dd>
                      {modelValue(sample.estimation.residualErrorM, ' m')}
                    </dd>
                    <dt>배치 지표 / 급이동</dt>
                    <dd>
                      {modelValue(sample.estimation.geometry, '', 2)} /{' '}
                      {sample.estimation.jump ? '감지' : '미감지'}
                    </dd>
                    <dt>모델 불확실성 추정</dt>
                    <dd>{modelValue(sample.accuracyM, ' m', 0)}</dd>
                    <dt>모델 신뢰 점수</dt>
                    <dd>{value(sample.confidence)} (위치 정확도 % 아님)</dd>
                    {sample.estimation.review&&<>
                      <dt>고객 좌표 채택 심사</dt>
                      <dd>{sample.estimation.review.accepted?'기본 품질 조건 통과 (실측 정확도 보증 아님)':'추정 보류 · 지도에서 제외'}</dd>
                      <dt>거리 포화 / 시간차</dt>
                      <dd>{sample.estimation.review.cappedSites}/{sample.estimation.siteCount}사이트 · 최대 {modelValue(sample.estimation.review.maxSiteOffsetSec,'초',1)}</dd>
                    </>}
                  </dl>
                  {sample.estimation.review&&!sample.estimation.review.accepted&&
                    <p className={styles.positionReviewReasons}>추정 보류 사유: {sample.estimation.review.reasons.join(' · ')}</p>}
                  <p>
                    진단:{' '}
                    {sample.estimation.warnings
                      .map((warning) => {
                        if (
                          warning.includes('단일 Site 좌표를 임시 위치로 사용')
                        )
                          return '기지국 1개 근거의 임시 좌표는 고객 위치에서 제외합니다. 방향은 알 수 없습니다.';
                        if (warning.includes('보정 오프셋 약'))
                          return (
                            warning.replace(
                              '보정 오프셋 약',
                              '엔진 반경 모델 가정',
                            ) + ' (GNSS 측정 정확도 미확인)'
                          );
                        return warning;
                      })
                      .join(' · ') || '없음'}
                  </p>
                  <details className={styles.raw}>
                    <summary>
                      엔진 원본 진단 (화면의 고객 위치 정책 적용 전)
                    </summary>
                    <p>{sample.estimation.warnings.join(' · ') || '없음'}</p>
                    <p>
                      원본 진단은 엔진 내부 가정을 포함합니다. 고객 위치 표시와
                      측정 정확도에 대한 설명은 위의 진단을 따릅니다.
                    </p>
                  </details>
                  <ul className={styles.evidence}>
                    {sample.estimation.usedSites.map((site) => (
                      <li key={site.siteId}>
                        {site.siteId} · 기지국{' '}
                        {site.baseStationIds.join(', ') || '미제공'} · 셀{' '}
                        {site.cellIds.join(', ') || '미제공'}
                        <br />
                        {site.latitude.toFixed(6)} / {site.longitude.toFixed(6)}{' '}
                        · RSRP {site.rsrp} dBm · 시간차{' '}
                        {modelValue(site.deltaTimeSec)}초 · 모델 거리{' '}
                        {site.estimatedDistanceM.toFixed(1)} m · 잔차{' '}
                        {site.residualM.toFixed(1)} m
                      </li>
                    ))}
                  </ul>
                  <p className={styles.helper}>
                    거리와 반경은 무선 모델의 참고값이며 검증된 위치 정확도가
                    아닙니다. 연결선은 고객 이동 경로가 아닙니다.
                  </p>
                </>
              )}
            </details>
          )}
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
              원본 고객번호: {call?.contractId || '미제공'} · 관측 CI:{' '}
              {sample.ci || '미제공'}
            </p>
            <p>
              원본 UTMK: X {value(sample.gnssX)} / Y {value(sample.gnssY)}
            </p>
            <pre>{JSON.stringify(sample.raw, null, 2)}</pre>
          </details>
        </>
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
      <details className={styles.raw}>
        <summary>관측 집계 기준</summary>
        <p className={styles.helper}>
          분모는 해당 무선값이 있는 이벤트입니다. 조건 건수는 원인 판정이
          아닙니다. QoE는 원본 통화 단위 값입니다. 시점별 무선값과 별도로
          표시합니다.
        </p>
      </details>
    </div>
  );
}

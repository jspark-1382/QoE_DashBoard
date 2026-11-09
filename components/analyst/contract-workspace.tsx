'use client';
import React, { useState } from 'react';
import type { AnalystCall, AnalystDay, OverviewCallLocation } from '../../lib/analyst/types';
import type { BaseStation } from '../../lib/location-estimation/types';
import {
  estimationReason,
  estimationSummary,
} from '../../lib/analyst/estimation-evidence';
import { isPoorCall } from '../../lib/analyst/data';
import { getMetricLegend, hasCustomerPoint } from '../../lib/analyst/map';
import { formatCallDuration } from '../../lib/analyst/call-duration';
import { classifySipReason11,sipReasonLabel } from '../../lib/analyst/sip-reason';
import { buildCallPciRows, pciEvidenceReason, selectExactCallStations } from '../../lib/analyst/pci-evidence';
import { byeSelectionDescription } from '../../lib/analyst/bye-selection';
import { AnalystMap } from './analyst-map';
import { MosCallInvestigation } from './mos-call-investigation';
import { RadioTimeline } from './radio-timeline';
import { ObservationDetails } from './observation-details';
import styles from './contract-workspace.module.css';
type Props = {
  day: AnalystDay;
  byeLocation?: OverviewCallLocation;
  /** Approximate call-level 3-site search centre, never a GNSS/sample coordinate. */
  roughLocation?: OverviewCallLocation;
  /** Only the customer's selected date partitions, never shared with another customer. */
  periodDays?: AnalystDay[];
  periodRange?: {start:string;end:string};
  onSelectPeriodDate?: (date:string)=>void;
  callId: string | null;
  sampleIndex: number | null;
  threshold: number;
  onSelectCall: (id: string) => void;
  onSelectSample: (index: number) => void;
  settingsOpen?: boolean;
  toolbar?: React.ReactNode;
};
const hasMdt = (c: AnalystCall) =>
  c.hasMdt ?? (c.mdtCount > 0 || c.sampleIndices.length > 0);
const duration = (c: AnalystCall) => {
  const clockSeconds = c.endSecond - c.startSecond;
  const s =
    c.durationSeconds ??
    (clockSeconds < 0 ? clockSeconds + 86400 : clockSeconds);
  return formatCallDuration(s);
};
export function ContractWorkspace({
  day,
  byeLocation,
  roughLocation,
  periodDays,
  periodRange,
  onSelectPeriodDate,
  callId,
  sampleIndex,
  threshold,
  onSelectCall,
  onSelectSample,
  settingsOpen,
  toolbar,
}: Props) {
  const [poorOnly, setPoorOnly] = useState(false),
    [mdtFilter, setMdtFilter] = useState('all'),
    [sort, setSort] = useState('time');
  const [metric, setMetric] = useState<'qoe' | 'rsrp' | 'rsrq' | 'sinr'>(
    'rsrp',
  );
  const [gnss, setGnss] = useState(true),
    [estimates, setEstimates] = useState(true),
    [stations, setStations] = useState(true);
  const [showEstimationEvidence, setShowEstimationEvidence] = useState(false);
  const call = day.calls.find((c) => c.id === callId) ?? null;
  const samples = call
    ? day.samples.filter((s) => s.callId === call.id && s.inCallWindow)
    : [];
  const sample = samples.find((s) => s.index === sampleIndex) ?? null;
  const positionSummary = estimationSummary(samples);
  const observedPoints=samples.filter(s=>hasCustomerPoint(s)&&
    ['gnss','measured'].includes(s.locationSource));
  const radioPoints=samples.filter(s=>hasCustomerPoint(s)&&s.locationSource==='radio');
  const interpolatedPoints=samples.filter(s=>hasCustomerPoint(s)&&s.locationSource==='interpolated');
  const modeledCount=radioPoints.length+interpolatedPoints.length;
  const withheldCount=positionSummary.withheld;
  const selectedReview=sample?.estimation?.review;
  const endReference=call?.endGnssReference;
  const mapReference=sample?.gnssReference??endReference;
  const activeReferenceLabel=sample?.gnssReference?'선택 MDT 관측 시각':'통화 종료 시각';
  const selectedPosition=selectedReview&&!selectedReview.accepted&&sample?.lat==null
    ? (roughLocation?'선택 관측 GPS 없음 · 통화 단위 삼각 측량 조사 권역 표시':'개별 관측 좌표 보류')
    : sample&&hasCustomerPoint(sample)
    ? ['gnss','measured'].includes(sample.locationSource)
      ? 'GPS 관측 · 실제 제공 좌표'
      : sample.locationSource==='radio'
        ? '고객 위치 추정 · 삼각 측량 (검증 전)'
        : '고객 위치 추정 · 보간 (검증 전)'
    : '위치 없음 · 무선 관측값만 제공';
  const evaluated = day.calls.filter(
      (c) => c.qoe !== null && Number.isFinite(c.qoe),
    ),
    poor = evaluated.filter((c) => isPoorCall(c.qoe, threshold));
  const valid = day.samples.filter((s) => s.inCallWindow),
    gnssCount = valid.filter((s) => s.locationSource === 'gnss').length;
  const gnssCoverageKnown =
    valid.length > 0 &&
    valid.every((s) => {
      const metadata = s.raw[21];
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
        return false;
      const m = metadata as Record<string, unknown>;
      return (
        typeof m.gnss === 'boolean' ||
        (typeof m.locationSource === 'string' &&
          [
            'gnss',
            'interpolated',
            'radio',
            'station',
            'measured',
            'unavailable',
          ].includes(m.locationSource)) ||
        Object.hasOwn(m, 'gnssUtmkx') ||
        Object.hasOwn(m, 'gnssUtmky')
      );
    });
  const calls = [...day.calls]
    .filter(
      (c) =>
        (!poorOnly || isPoorCall(c.qoe, threshold)) &&
        (day.source !== 'MDT' ||
          mdtFilter === 'all' ||
          (mdtFilter === 'mdt' ? hasMdt(c) : !hasMdt(c))),
    )
    .sort((a, b) =>
      sort === 'poor'
        ? (a.qoe ?? Infinity) - (b.qoe ?? Infinity) ||
          a.startSecond - b.startSecond
        : a.startSecond - b.startSecond,
    );
  const cdrOnly = day.source === 'MDT' && call !== null && !hasMdt(call);
  // Use the overview's selected BYE tower reference, preserving how it was chosen;
  // a first-candidate fallback is never a measured handset coordinate.
  const byeEntry=byeLocation&&byeLocation.byeCellId===call?.endCellId &&
    byeLocation.byeRuId&&
    (byeLocation.evidence==='bye-cell'||
     (byeLocation.byeStationLat!=null&&byeLocation.byeStationLon!=null))
      ? byeLocation:null;
  const byeStation:BaseStation|null=byeEntry
    ? {baseStationId:byeEntry.byeRuId!,cellId:byeEntry.byeCellId!,
       latitude:byeEntry.evidence==='bye-cell'?byeEntry.lat:byeEntry.byeStationLat!,
       longitude:byeEntry.evidence==='bye-cell'?byeEntry.lon:byeEntry.byeStationLon!,
       frequency:null,isVirtual:false,provenanceUnknown:true,
       pci:byeEntry.byePci??null,inventorySource:byeEntry.byeInventory,
       technology:byeEntry.byeTechnology,
       inventoryPciStatus:byeEntry.byeInventoryPciStatus,
       inventoryPciCandidates:byeEntry.byeInventoryPciCandidates}
    : null;
  const callStations=selectExactCallStations(day.baseStations,samples);
  const stationMarkers=cdrOnly?(byeStation?[byeStation]:[]):[
    ...callStations,
    ...(byeStation&&!callStations.some(site=>site.baseStationId===byeStation.baseStationId&&
      site.cellId===byeStation.cellId&&(site.technology??'LTE')===(byeStation.technology??'LTE'))?[byeStation]:[]),
  ];
  const activeByeStation=byeStation && stationMarkers.some(s=>
    s.baseStationId===byeStation.baseStationId&&s.cellId===byeStation.cellId)
    ? byeStation : null;
  const stationPciRows=buildCallPciRows(day.baseStations,samples,byeStation?[byeStation]:[]);
  return (
    <div className={styles.workspace}>
      <div className={styles.contextBar}>
        {toolbar}
        <div className={styles.summary} aria-label="현재 고객 일자 요약">
          <span>
            통화 <b>{day.calls.length}</b>건
          </span>
          <span>
            평가 가능 <b>{evaluated.length}</b>건
          </span>
          <span title={`저품질 ${day.source === 'MDT' ? 'QoE' : 'QoE'} < ${threshold}`}>
            저품질{' '}
            <b className={styles.poor}>
              {poor.length} / {evaluated.length}
            </b>
            건
          </span>
          <span
            title={
              gnssCoverageKnown
                ? `통화 중 유효 관측 ${valid.length}건 중 GPS ${gnssCount}건`
                : 'GPS 출처 정보 미제공'
            }
          >
            GPS 확보율{' '}
            <b>
              {gnssCoverageKnown
                ? `${((gnssCount / valid.length) * 100).toFixed(1)}%`
                : '미제공'}
            </b>
          </span>
        </div>
      </div>
      {periodRange&&<section className={styles.periodNavigation} aria-label="선택 고객 기간별 통화">
        <strong>{periodRange.start} ~ {periodRange.end}</strong>
        {periodDays
          ? <><span>기간 통화 {periodDays.reduce((n,d)=>n+d.calls.length,0).toLocaleString()}건
              {' · '}저품질 {periodDays.reduce((n,d)=>n+d.calls.filter(c=>isPoorCall(c.qoe,threshold)).length,0).toLocaleString()}건</span>
              <div>{periodDays.map(d=><button type="button" key={d.date}
                aria-pressed={d.date===day.date}
                onClick={()=>onSelectPeriodDate?.(d.date)}>
                {d.date.slice(5)} ({d.calls.length}건)
              </button>)}</div></>
          : <span>선택 고객의 기간별 통화를 불러오는 중…</span>}
        <small>일자 선택 후 아래에서 개별 통화를 조사합니다.</small>
      </section>}
      {settingsOpen && (
        <div className={styles.settings}>
          <strong>분석 설정</strong>
          <p>
            GPS 원본 EPSG:5179 · 기지국 좌표는 고객 위치가 아닙니다. RSRP −105
            dBm / SINR 0 dB 관측을 탐색하며 시간축은 30초 초과 공백에서 선을
            끊습니다.
          </p>
        </div>
      )}
      <div className={styles.columns}>
        <aside className={styles.callPanel} id="contract-call-rail">
          <div className={styles.panelHeading}>
            <h3>
              통화 목록 <span>{day.calls.length}</span>
            </h3>
            <select
              aria-label="통화 정렬"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="time">시각순</option>
              <option value="poor">저품질순</option>
            </select>
          </div>
          <div className={styles.callTools}>
            <div className={styles.tabs} aria-label="통화 품질 필터">
              <button
                type="button"
                aria-pressed={!poorOnly}
                onClick={() => setPoorOnly(false)}
              >
                전체
              </button>
              <button
                type="button"
                aria-pressed={poorOnly}
                onClick={() => setPoorOnly(true)}
              >
                저품질
              </button>
            </div>
            {day.source === 'MDT' && (
              <select
                aria-label="MDT 관측 여부"
                value={mdtFilter}
                onChange={(e) => setMdtFilter(e.target.value)}
              >
                <option value="all">자료 전체</option>
                <option value="mdt">MDT 있음</option>
                <option value="cdr">CDR만</option>
              </select>
            )}
          </div>
          <div className={styles.callList}>
            <table aria-label="고객 통화 목록">
              <thead>
                <tr>
                  <th>시작 시각</th>
                  <th title="원본 시간을 초 단위로 반올림">통화 시간</th>
                  <th>{day.source === 'MDT' ? 'QoE' : 'QoE'}</th>
                  {day.source === 'MDT' && <th title="원본 SIP CDR 11.REASON 종료 사유 (SIP 응답코드 아님)">상태</th>}
                  <th>자료</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr
                    key={c.id}
                    className={c.id === callId ? styles.selected : ''}
                    aria-selected={c.id === callId}
                  >
                    <td>
                      <button
                        type="button"
                        aria-label={`${c.start} 통화 분석`}
                        aria-pressed={c.id === callId}
                        onClick={() => onSelectCall(c.id)}
                      >
                        {c.start}
                      </button>
                    </td>
                    <td className={styles.durationCell} title={Number.isFinite(c.durationSeconds)?'원본 '+c.durationSeconds!.toFixed(3)+'초 · 표시 초 단위 반올림':'초 단위 반올림'}>{duration(c)}</td>
                    <td
                      className={
                        isPoorCall(c.qoe, threshold) ? styles.poor : ''
                      }
                    >
                      {c.qoe === null ? (
                        <span className={styles.muted}>평가 불가</span>
                      ) : (
                        <>
                          {isPoorCall(c.qoe, threshold) && (
                            <i className={styles.poorDot} />
                          )}{' '}
                          {c.qoe.toFixed(2)}
                        </>
                      )}
                    </td>
                    {day.source === 'MDT' && <td>
                      <span className={styles.sipReasonBadge}
                        data-reason={classifySipReason11(c.sipCause)}
                        title={'SIP CDR 11.REASON: '+(c.sipCause||'원본 값 없음')+' · SIP 응답코드가 아닌 통화 종료 사유입니다.'}>
                        {sipReasonLabel(classifySipReason11(c.sipCause))}
                      </span>
                    </td>}
                    <td>
                      <span
                        className={styles.dataBadge}
                        title={
                          day.source === 'MDT'
                            ? hasMdt(c)
                              ? `MDT ${c.mdtCount ?? c.sampleIndices.length}건`
                              : 'CDR만 있음 · MDT 관측 없음'
                            : '실측 자료'
                        }
                      >
                        {day.source === 'MDT'
                          ? hasMdt(c)
                            ? 'MDT'
                            : 'CDR'
                          : '실측'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!calls.length && (
              <p className={styles.empty}>표시할 통화가 없습니다.</p>
            )}
          </div>
          {call && !calls.some((c) => c.id === call.id) && (
            <p className={styles.filterNote}>
              선택 통화는 현재 목록 필터 밖입니다.
            </p>
          )}
          <div className={styles.callFoot}>
            <i className={styles.poorDot} /> 저품질: {day.source === 'MDT' ? 'QoE' : 'QoE'} &lt; {threshold}
          </div>
        </aside>
        <main className={styles.center}>
          <section className={styles.mapPanel} aria-label="선택 통화 지도">
            <div className={styles.mapHeading}>
              <div className={styles.callTitle}>
                <h3>
                  {call
                    ? `선택 통화 ${call.start} – ${call.end}`
                    : '통화를 선택하세요'}
                </h3>
                <span>
                  {day.source === 'MDT' ? 'QoE' : 'QoE'}{' '}
                  <b
                    className={
                      call && isPoorCall(call.qoe, threshold) ? styles.poor : ''
                    }
                  >
                    {call?.qoe != null ? call.qoe.toFixed(2) : '평가 불가'}
                  </b>
                </span>
                {day.source === 'MDT' && call && <span className={styles.mapSource}>
                  등급 {call.mos === null ? '미평가' : call.mos < 3 ? '불량' : call.mos < 3.5 ? '주의' : '양호'}
                  {' · '}MDT {call.matchStatus === 'MATCHED' ? '시간기준 단독후보' : call.matchStatus === 'AMBIGUOUS' ? '매칭 모호' : '미매칭'}
                </span>}
                <span className={styles.mapSource}>
                  {cdrOnly
                    ? 'CDR만 · MDT 없음'
                    : day.source === 'MDT'
                      ? `MDT ${samples.length}건`
                      : '실측 관측'}
                </span>
              </div>
              <div className={styles.mapTools}>
                <div className={styles.layers}>
                  <label>
                    <input
                      type="checkbox"
                      checked={gnss}
                      onChange={(e) => setGnss(e.target.checked)}
                    />
                    {day.source === 'MDT' ? 'GPS 실측' : '실측 좌표'}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={estimates}
                      onChange={(e) => setEstimates(e.target.checked)}
                    />
                    고객 위치 추정
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={stations}
                      onChange={(e) => setStations(e.target.checked)}
                    />
                    기지국 위치
                  </label>
                </div>
                <details className={styles.mapOptions} aria-label="지도 옵션">
                  <summary>지도 옵션</summary>
                  <div className={styles.optionBody}>
                    <label className={styles.metricField}>
                      저하 강조 기준{' '}
                      <select
                        aria-label="지도 저하 강조 지표"
                        value={metric}
                        onChange={(e) =>
                          setMetric(e.target.value as typeof metric)
                        }
                      >
                        <option value="rsrp">RSRP (dBm)</option>
                        <option value="rsrq">RSRQ (dB)</option>
                        <option value="sinr">SINR (dB)</option>
                        <option value="qoe">통화 {day.source === 'MDT' ? 'QoE' : 'QoE'}</option>
                      </select>
                    </label>
                    <div
                      aria-label="지도 품질 저하 수치 기준"
                      className={styles.colorLegend}
                    >
                      {getMetricLegend(metric, threshold).map((item) => (
                        <span key={item.kind}>
                          <i style={{ backgroundColor: item.color }} />
                          {item.label}
                        </span>
                      ))}
                    </div>
                    <p>지도 마커의 본체 색은 위치 근거를 나타내며, 빨간 테두리는 선택 지표의 기준 미달 관측입니다.</p>
                    {metric === 'sinr' && (
                      <p>지도 색상 3 dB 기준 · 관측 탐색 0 dB 기준</p>
                    )}
                    {day.source === 'MDT' && (
                      <div
                        className={styles.estimationStatus}
                        aria-label="자동 위치 추정 상태"
                      >
                        <strong>자동 위치 추정</strong>
                        <p>
                          GPS {positionSummary.gnss}건 · 3개 이상 기지국
                          삼각 측량 {positionSummary.multi}건 · 2개 기지국
                          가중중심 {positionSummary.two}건 · 위치 보류{' '}
                          {positionSummary.unavailable}건 · 검토 보류{' '}
                          {positionSummary.withheld}건
                        </p>
                        <label>
                          <input
                            type="checkbox"
                            checked={showEstimationEvidence}
                            onChange={(e) =>
                              setShowEstimationEvidence(e.target.checked)
                            }
                          />
                          추정 근거 보기
                        </label>
                        <button
                          type="button"
                          disabled={!positionSummary.radioIndices.length}
                          onClick={() => {
                            setEstimates(true);
                            const next =
                              positionSummary.radioIndices.find(
                                (index) => index > (sampleIndex ?? -1),
                              ) ?? positionSummary.radioIndices[0];
                            if (next !== undefined) onSelectSample(next);
                          }}
                        >
                          삼각 측량 시점으로 이동 (
                          {positionSummary.radioIndices.length}건)
                        </button>
                        {positionSummary.withheldIndices.length>0&&<button type="button"
                          onClick={()=>{
                            setShowEstimationEvidence(true);
                            const next=positionSummary.withheldIndices.find(index=>index>(sampleIndex??-1))
                              ??positionSummary.withheldIndices[0];
                            onSelectSample(next);
                          }}>
                          추정 보류 관측 확인 ({positionSummary.withheldIndices.length}건)
                        </button>}
                        {sample && <p>{estimationReason(sample)}</p>}
                        <p>
                          GPS 우선 · 고객 추정 좌표는 검토를 통과한 3개 이상 독립 기지국만 표시합니다.
                          2개 이하 기지국, 거리 포화, 높은 모델 불확실성 등은 보류합니다.
                        </p>
                      </div>
                    )}
                  </div>
                </details>
              </div>
            </div>
            {call&&<div className={styles.positionSummary} aria-label="고객 위치 출처 요약">
              <div className={styles.positionSummaryTitle}>
                <b>이동 위치 근거</b>
                <span>GPS 실측 / 추정 위치 구분</span>
              </div>
              <div className={styles.positionBadges}>
                <span className={styles.positionObserved}><i className={styles.gnssSymbol}/> GPS 관측 <b>{observedPoints.length}건</b></span>
                <span className={styles.positionModel}><i className={styles.modelSymbol}/> 삼각 측량 <b>{radioPoints.length}건</b></span>
                <span className={styles.positionInterpolation}><i className={styles.interpolatedSymbol}/> 보간 추정 <b>{interpolatedPoints.length}건</b></span>
                <span className={styles.positionStation}><i className={styles.stationSymbol}/> 기지국 <b>{stationMarkers.length}곳</b></span>
                {roughLocation&&<span className={styles.positionModel}><i className={styles.modelSymbol}/> 삼각 측량 근사 <b>1건</b></span>}
                {withheldCount>0&&<span className={styles.positionWithheld}> <i className={styles.withheldSymbol}/> 추정 보류 <b>{withheldCount}건</b></span>}
              </div>
              {sample&&<p className={styles.selectedPositionStatus}><b>선택 관측 #{sample.index}</b> · {selectedPosition}</p>}
              {roughLocation&&<p className={styles.roughSummary} aria-label="선택 통화 삼각 측량 대략 위치">
                <b>삼각 측량 대략 위치</b> · {roughLocation.lat.toFixed(3)}, {roughLocation.lon.toFixed(3)}
                {' '}· 조사 반경 약 {Math.round(roughLocation.roughSearchRadiusM??0).toLocaleString()}m
                <span>통화 단위 후보 · 실제 단말 위치 아님</span>
              </p>}
              {roughLocation&&<details className={styles.technicalDetails} aria-label="통화 삼각 측량 대략 위치 근거">
                <summary>삼각 측량 근거 보기</summary>
                <div className={styles.roughEvidence}>
                  <p>MDT 기준 {roughLocation.observedAt??'시각 미확인'} · 사용 사이트 {roughLocation.usedSiteCount??0}곳.
                    RSRP 가중중심으로 계산한 조사 중심이며 단말 위치·실제 QoE 저하 지점이 아닙니다.
                    조사 반경은 검증된 위치 정확도/신뢰구간이 아닙니다.</p>
                  <ul>{(roughLocation.usedStations??[]).map(site=>
                    <li key={site.ruId+':'+site.cellId}>{site.ruId} / Cell {site.cellId} · RSRP {site.rsrpDbm.toFixed(1)} dBm</li>)}</ul>
                </div>
              </details>}
              {mapReference&&<details className={styles.technicalDetails} aria-label="GPS 기준점 세부 근거"><summary>최근 GPS 기준점 자세히</summary><div className={styles.gnssReference}>
                <strong>마지막 GPS 실측 기준점 + {activeReferenceLabel} 참고</strong>
                <span>GPS 관측 {new Date(mapReference.observedAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})}
                  {' '}· 경과 {mapReference.ageSeconds.toFixed(1)}초
                  {' '}· 이동 가능 범위 반경 약 {mapReference.movementRadiusM.toLocaleString()}m</span>
                <small>GPS 위치는 실제 관측한 좌표이나 이후 MDT/BYE 시점의 실측 위치는 아닙니다.
                  속도 120km/h와 기본 위치 오차 250m를 가정한 참고 범위이며,
                  실제 위치 정확도·고객 이동경로·기지국 서비스 반경을 보증하지 않습니다.
                  {activeByeStation
                    ? ' BYE 종료 기지국 '+activeByeStation.baseStationId+'은 별도 위치 관계로 표시합니다.'
                    : ' BYE Cell 기지국 참고 위치가 없으면 기지국 거리 제약은 적용하지 않습니다.'}
                </small>
              </div></details>}
              {endReference&&sample?.gnssReference&&endReference.observedAt!==sample.gnssReference.observedAt&&
                <p className={styles.selectedPositionStatus}>통화 종료 시점의 가장 최근 GPS는 별도 관측이며,
                  종료 기준 경과 {endReference.ageSeconds.toFixed(1)}초 · 범위 반경 약 {endReference.movementRadiusM.toLocaleString()}m입니다.</p>}
              {withheldCount>0&&<details className={styles.technicalDetails} aria-label="좌표 심사 근거"><summary>좌표 심사 근거 보기 · {withheldCount}건 보류</summary><div className={styles.noGnssWarning}>
                무선 계산 후보 {withheldCount}건은 거리 포화·모델 불확실성·관측 시간차 등의 검토를 통과하지 못해 고객 좌표를 표시하지 않습니다.
                {activeByeStation
                  ? ' BYE 종료 기지국 '+activeByeStation.baseStationId+' (Cell '+activeByeStation.cellId+')만 별도 강조합니다. 기지국은 단말의 위치가 아닙니다.'
                  : ' BYE Cell 기지국 참고 위치를 확인하지 못했습니다.'}
              </div></details>}
              {modeledCount>0&&observedPoints.length===0&&
                <p className={styles.noGnssWarning}>이 통화에는 GPS 관측 위치가 없습니다. 지도에 표시된 고객 위치는 삼각 측량 또는 보간으로 추정한 좌표입니다.</p>}
            </div>}
            {cdrOnly ? (
              <div className={styles.cdrOnly} aria-label="CDR 통화 위치 정보">
                <strong>CDR만 있는 통화</strong>
                <p>MDT 관측과 고객 이동 경로가 없습니다.</p>
                <dl>
                  <div>
                    <dt>시작 · Invite</dt>
                    <dd>
                      {call.start}
                      <span>Cell-ID {call.startCellId || '미제공'}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>종료 · Bye</dt>
                    <dd>
                      {call.end}
                      <span>Cell-ID {call.endCellId || '미제공'}</span>
                    </dd>
                  </div>
                </dl>
                <p>{byeStation
                  ? 'BYE Cell에 연결된 기지국 참고 위치를 지도에 표시합니다. 기지국 좌표는 고객 단말 위치가 아닙니다.'
                  : 'Cell 위치 미제공 · BYE Cell에 연결 가능한 기지국 좌표가 없습니다.'}</p>
              </div>
            ) : null}
            {stationPciRows.length>0&&<details className={styles.technicalDetails} aria-label="선택 통화의 기지국 연결"><summary>기지국 연결·PCI {stationPciRows.length}개 자세히</summary><div className={styles.stationSummary}>
              <div className={styles.stationTableScroll}>
                <table className={styles.stationTable} aria-label="선택 통화 PCI 비교">
                  <thead><tr><th scope="col">RU</th><th scope="col">Cell</th><th scope="col">등록 PCI</th><th scope="col">관측 PCI</th><th scope="col">비교</th><th scope="col">정보 출처</th></tr></thead>
                  <tbody>{stationPciRows.map(row=><tr key={JSON.stringify([row.technology??'LTE',row.baseStationId,row.cellId])}>
                    <td>{row.baseStationId||'미제공'}</td>
                    <td>{row.cellId||'미제공'}</td>
                    <td>{row.registeredPci??'미확인'}{row.reason==='registry-conflict'&&row.registeredCandidates.length>0&&<small>후보 {row.registeredCandidates.join(' · ')}</small>}</td>
                    <td>{row.observedPcis.length?row.observedPcis.join(' · '):'미제공'}</td>
                    <td><span className={styles.pciComparison} data-pci-comparison={row.comparison}>
                      {row.observationCount===0?'미확인':[
                        row.matched>0?'일치 '+row.matched:null,
                        row.mismatched>0?'불일치 '+row.mismatched:null,
                        row.unknown>0?'미확인 '+row.unknown:null,
                      ].filter(Boolean).join(' · ')}
                    </span>{row.comparison==='unknown'&&<small>{pciEvidenceReason(row)}</small>}</td>
                    <td>{row.inventorySources.join(' · ')||'출처 미제공'}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <small className={styles.pciNote}>등록 PCI는 RU·Cell 정확 일치 기준 · 비교 건수는 MDT 관측 수입니다. 기지국 정보 기준 시점과 통화 관측 시점이 다를 수 있습니다. 불일치만으로 장애나 PCI 충돌을 확정하지 않습니다.</small>
              <small>{activeByeStation
                ? '종료 BYE 기지국 '+activeByeStation.baseStationId+' / Cell '+activeByeStation.cellId+' · 기지국 좌표이며 단말 위치 아님'
                : withheldCount>0&&call?.endCellId
                  ? 'CDR 종료 Cell '+call.endCellId+'의 연결 가능한 RU 좌표 없음 · 아래는 MDT 기지국 참고 위치이며 단말 위치 아님'
                  : 'MDT에 연결된 기지국 참고 위치 · 단말 위치 아님'}</small>
              {!stations&&<button type="button" onClick={()=>setStations(true)}>지도에 기지국 표시</button>}
            </div></details>}
            {activeByeStation&&byeEntry&&<p className={styles.selectedPositionStatus} data-bye-selection={byeEntry.byeSelectionMethod??'unknown'}>
              BYE 기지국 선택: {byeSelectionDescription(byeEntry)} · RU {activeByeStation.baseStationId} · 단말 위치 아님
            </p>}
            {(!cdrOnly||byeStation)&&(
              <div className={styles.map}>
                <AnalystMap
                  threshold={threshold}
                  samples={samples}
                  callLocations={estimates&&roughLocation?[roughLocation]:[]}
                  selectedIndex={sampleIndex}
                  onSampleSelect={onSelectSample}
                  stations={stationMarkers}
                  byeSiteCellId={activeByeStation?.cellId}
                  byeSiteRuId={activeByeStation?.baseStationId}
                  byeSiteTechnology={activeByeStation?.technology}
                  byeSiteSelectionLabel={byeEntry?byeSelectionDescription(byeEntry):undefined}
                  gnssReference={mapReference}
                  metric={metric}
                  showGnss={gnss}
                  showEstimates={estimates}
                  showStations={stations}
                  showEstimationEvidence={showEstimationEvidence}
                  emphasizeLocationSource
                  focusKey={`${day.customerId}/${day.date}/${callId}`}
                  source={day.source}
                />
              </div>
            )}
            <div className={styles.legend} aria-label="지도 위치 출처 범례">
              <span><i className={styles.gnssSymbol}/> GPS 실측</span>
              {mapReference&&<span><i className={styles.gnssReferenceSymbol}/> 최근 GPS 기반 이동 가능 범위 (실제 경로 아님)</span>}
              <span><i className={styles.modelSymbol}/> 삼각 측량</span>
              {roughLocation&&<span><i className={styles.modelSymbol}/> 삼각 측량 조사 권역 (실측 아님)</span>}
              <span><i className={styles.interpolatedSymbol}/> 보간 추정</span>
              <span><i className={styles.stationSymbol}/> 기지국 (단말 아님)</span>
              {activeByeStation&&<span><i className={styles.byeStationSymbol}/> BYE 종료 기지국 (단말 아님)</span>}
              {withheldCount>0&&<span><i className={styles.withheldSymbol}/> 추정 보류 (지도 좌표 없음)</span>}
              <span className={styles.legendNote}>
                위치 출처는 색상·모양으로 구분 · 빨간 테두리는 선택 품질 지표 저하
              </span>
            </div>
          </section>
          {day.source === 'MDT' && call && (
            <MosCallInvestigation call={call} samples={samples} />
          )}
          <RadioTimeline
            key={`${day.customerId}/${day.date}/${callId}`}
            samples={samples}
            selectedIndex={sampleIndex}
            onSelectSample={onSelectSample}
          />
        </main>
        <aside className={styles.detailsPanel}>
          <ObservationDetails
            sample={sample}
            call={call}
            samples={samples}
            source={day.source}
            roughLocation={roughLocation}
            stations={day.baseStations}
          />
        </aside>
      </div>
      <p className={styles.footer}>
        {day.source === 'MDT'
          ? '통화 품질은 SIP CDR 원본 RTCP QoE(v5) 기준 · MDT는 무선 관측 근거'
          : '실측 자료 기준'}{' '}
        · 현재 고객 / 선택 일자 기준
      </p>
    </div>
  );
}

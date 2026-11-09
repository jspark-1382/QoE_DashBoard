'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from './document-link';
import { loadDataset, loadDay, loadOverview } from '../../lib/analyst/data-loader';
import { buildImprovedView, buildOriginalCallLink, type ImprovedLocationFilter } from '../../lib/analyst/improved-overview';
import { AnalystMap } from './analyst-map';
import { MosCallInvestigation } from './mos-call-investigation';
import type { AnalystDataset, AnalystDay, AnalystOverview } from '../../lib/analyst/types';
import styles from './improved-quality-overview.module.css';
import { QualityTopNav } from './quality-top-nav';
import { byeSelectionDescription } from '../../lib/analyst/bye-selection';

type Loaded = { dataset: AnalystDataset; overview: AnalystOverview };
type DataState = { loading: boolean; value: Loaded | null; error: string | null };
const fmt = (value: number) => value.toLocaleString('ko-KR');
const percent = (num: number, total: number) => total ? (100 * num / total).toFixed(2) + '%' : '—';
const validMos = (value: number | null | undefined) => value != null && Number.isFinite(value) && value >= 1 && value <= 5;
const grades = (mos: number | null | undefined) =>
  !validMos(mos) ? '미평가' : mos! < 3 ? '불량' : mos! < 3.5 ? '보통' : '양호';
const LABELS: Record<ImprovedLocationFilter,string> = {
  all: '전체 위치', gnss: 'GPS 관측만', estimated: '삼각 측량만', 'bye-cell':'BYE 기지국만',
};

export function ImprovedQualityOverview() {
  const [selectedDate,setSelectedDate]=useState('2026-10-30');
  const [data, setData] = useState<DataState>({ loading: true, value: null, error: null });
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');
  const [hour, setHour] = useState<number | null>(null);
  const [district, setDistrict] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<ImprovedLocationFilter>('all');
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{key:string; day:AnalystDay|null; loading:boolean; error:string|null}>({
    key:'',day:null,loading:false,error:null,
  });
  const [focus, setFocus] = useState<{key:string;lat:number;lon:number}>();
  const [limit, setLimit] = useState(20);
  const focusSequence = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const dataset = await loadDataset('MDT', controller.signal);
        if (dataset.meta.qoeBasis !== 'rtcp-mos-v5') throw new Error('개선 화면은 RTCP QoE(v5) CDR 원본을 사용합니다.');
        const date = selectedDate;
        if (!dataset.meta.dates.includes(date)) throw new Error('선택 일자 원본이 없습니다: '+date);
        const overview = await loadOverview(dataset, 'MDT', date, controller.signal);
        if (overview.spatialUnit !== 'administrative-dong' || !overview.administrativeDongs?.length ||
            !overview.callLocations) throw new Error('행정동 경계와 발생 지점이 없습니다. npm run data:overview -- MDT를 실행하세요.');
        if (!controller.signal.aborted) setData({ loading: false, value:{dataset,overview}, error:null });
      } catch (error) {
        if (!controller.signal.aborted) setData({
          loading:false,value:null,error:error instanceof Error ? error.message : '품질현황 자료 로딩 실패',
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [selectedDate]);

  const overview = data.value?.overview;
  const dataset = data.value?.dataset;
  const model = useMemo(() => overview ? buildImprovedView(overview, {
    from:startTime,to:endTime,hour,districtId:district,evidence,
  }) : null, [overview,startTime,endTime,hour,district,evidence]);

  const callLookup = useMemo(() => new Map((overview?.calls ?? []).map((c) => [c.id,c])), [overview]);
  const selected = selectedCallId ? callLookup.get(selectedCallId) ?? null : null;
  const selectedLocation = model?.markerByCall.get(selectedCallId ?? '') ?? null;
  const maxHour = Math.max(1,...(model?.hourly.map((h) => h.evaluated) ?? [1]));
  const maxArea = Math.max(1,model?.regions[0]?.poorCalls ?? 1);
  const date = overview?.date ?? '2026-10-30';
  const originalQuery = new URLSearchParams({
    source:'MDT',view:'overview',date,from:startTime,to:endTime,poor:'1',sort:'poor',page:'0',metric:'mos',
  });
  if (hour !== null) originalQuery.set('hour',String(hour));
  if (district) originalQuery.set('cell',district);
  const originalLink = '/?' + originalQuery.toString();

  useEffect(() => {
    const controller = new AbortController();
    const call = selectedCallId ? callLookup.get(selectedCallId) : null;
    if (!call || !dataset) return;
    const key = call.customerId + ':' + date;
    const entry = dataset.days.find((day) => day.customerId === call.customerId && day.date === date);
    if (!entry) {
      queueMicrotask(() => setDetail({key,day:null,loading:false,error:'선택 통화의 고객 상세 데이터가 없습니다.'}));
      return;
    }
    queueMicrotask(() => setDetail({key,day:null,loading:true,error:null}));
    loadDay(dataset,entry,'MDT',controller.signal).then(
      (day) => { if(!controller.signal.aborted) setDetail({key,day,loading:false,error:null}); },
      (error) => { if(!controller.signal.aborted) setDetail({
        key,day:null,loading:false,error:error instanceof Error?error.message:'통화 상세 불러오기 실패',
      }); },
    );
    return () => controller.abort();
  }, [dataset,date,selectedCallId,callLookup]);

  const selectedDayCall = detail.day?.calls.find(
    (call) => call.id === (selected?.rawCallId ?? selected?.id.slice(selected.customerId.length + 1)),
  );
  const selectDistrict = (id:string|null) => {
    setDistrict((old)=> old === id ? null : id);
    setSelectedCallId(null);
    setLimit(20);
    if (id && overview) {
      const place = overview.administrativeDongs?.find((d)=> d.id === id);
      if (place) setFocus({key:'district-'+(++focusSequence.current),lat:place.lat,lon:place.lon});
    } else {
      setFocus(undefined);
    }
  };
  const reset = () => {
    setStartTime('00:00');setEndTime('23:59');setHour(null);setDistrict(null);
    setEvidence('all');setSelectedCallId(null);setLimit(20);setFocus(undefined);
  };
  const switchHour = (target:number) => {
    setHour((old)=>old === target?null:target);
    setSelectedCallId(null);setLimit(20);
  };
  const switchEvidence = (next:ImprovedLocationFilter) => {
    setEvidence(next);setSelectedCallId(null);setLimit(20);
  };

  return (
    <div className={styles.shell}>
      <QualityTopNav active="legacy" date={selectedDate} legacyHref={originalLink}
        sourceLabel="MDT · Voice"/>

      <main className={styles.main}>
        <div className={styles.titleRow}>
          <div>
            <div className={styles.eyebrow}>개선안 비교 화면 · 원본 품질현황은 변경하지 않음</div>
            <h1>품질현황_개선 <span>저QoE 통화 위치 중심 분석</span></h1>
            <p>행정동 경계에서 위치를 찾고, 발생 통화를 선택해 QoE·RTP·무선 관측 근거를 확인합니다.</p>
          </div>
          <Link className={styles.compare} href={originalLink}>기존 품질 현황과 비교</Link>
        </div>

        {data.loading && <output className={styles.state}>{selectedDate} SIP CDR·행정동 경계 데이터를 불러오는 중입니다…</output>}
        {data.error && <div className={styles.error} role="alert">{data.error}</div>}
        {model && overview && <>
          <section className={styles.controls} aria-label="개선 품질현황 조사 조건">
            <div className={styles.controlGroup}>
              <span className={styles.groupLabel}>분석 일자</span>
              <select aria-label="분석 일자" value={selectedDate} onChange={event=>{
                setSelectedDate(event.target.value);
                setData({loading:true,value:null,error:null});
                setHour(null);setDistrict(null);setEvidence('all');setSelectedCallId(null);
                setFocus(undefined);setLimit(20);
              }}>
                {(data.value?.dataset.meta.dates??[selectedDate]).map(date=>
                  <option key={date} value={date}>{date}</option>)}
              </select>
            </div>
            <div className={styles.controlGroup}>
              <label htmlFor="improved-from">시작</label>
              <input id="improved-from" type="time" value={startTime} onChange={(event) => {
                setStartTime(event.target.value || '00:00');setHour(null);setSelectedCallId(null);
              }}/>
              <label htmlFor="improved-to">종료</label>
              <input id="improved-to" type="time" value={endTime} onChange={(event) => {
                setEndTime(event.target.value || '23:59');setHour(null);setSelectedCallId(null);
              }}/>
            </div>
            <div className={styles.controlGroup}>
              <span className={styles.groupLabel}>위치 신뢰도</span>
              <fieldset className={styles.segment}><legend className={styles.srOnly}>위치 근거 필터</legend>
                {(['all','gnss','estimated','bye-cell'] as const).map((item) =>
                  <button key={item} type="button" aria-pressed={evidence===item}
                    onClick={()=>switchEvidence(item)}>{LABELS[item]}</button>)}
              </fieldset>
            </div>
            <button type="button" className={styles.reset} onClick={reset}>전체 초기화</button>
          </section>
          {!model.validRange && <div className={styles.error} role="alert">시간 범위가 유효하지 않습니다. 시작은 종료보다 빨라야 합니다.</div>}

          <section className={styles.kpis} aria-label="CDR QoE 종합 성과 지표">
            <div className={styles.kpi}><span>전체 CDR 통화</span><strong>{fmt(model.globalSummary.total)}</strong><small>선택 날짜 및 시간 범위</small></div>
            <div className={styles.kpi}><span>QoE 평가 가능</span><strong>{fmt(model.globalSummary.evaluated)}</strong>
              <small>유효 QoE 비율 {percent(model.globalSummary.evaluated,model.globalSummary.total)}</small></div>
            <div className={styles.kpi}><span>저품질 통화</span><strong className={styles.danger}>{fmt(model.globalSummary.poor)}</strong>
              <small>평가 가능 대비 {percent(model.globalSummary.poor,model.globalSummary.evaluated)} · QoE &lt; 3.0</small></div>
            <div className={styles.kpi}><span>QoE 미평가</span><strong>{fmt(model.globalSummary.unscored)}</strong>
              <small>전체 대비 {percent(model.globalSummary.unscored,model.globalSummary.total)}</small></div>
            <div className={styles.kpi}><span>평균 QoE(v5)</span><strong>{model.meanMos == null ? '—' : model.meanMos.toFixed(2)}</strong>
              <small>유효 QoE 통화 기준</small></div>
            <div className={styles.kpi}><span>위치 연결된 저품질</span><strong>{fmt(model.locatedPoorCalls)}</strong>
              <small>저QoE 부분표본 · 필터 조건 적용</small></div>
          </section>

          <section className={styles.workspace} aria-label="저품질 발생 위치 조사">
            <div className={styles.mapPanel}>
              <div className={styles.panelHead}>
                <div><h2>행정동 경계 + 저QoE 통화 연계 위치</h2>
                  <p>지도 마커 클릭 → QoE·통화 시각 → 통화 분석</p></div>
                <span className={styles.countBubble}>{fmt(model.locations.length)}개 위치 지점</span>
              </div>
              <div className={styles.map}>
                <AnalystMap
                  administrativeDongs={overview.administrativeDongs}
                  cells={model.mapCells}
                  callLocations={model.locations}
                  onCallLocationSelect={(id) => setSelectedCallId(id)}
                  selectedCellId={district}
                  onCellSelect={selectDistrict}
                  focusTarget={focus}
                  focusKey={overview.source+'-'+overview.date+'-improved'}
                  source={overview.source}
                />
              </div>
              <div className={styles.mapLegend}>
                <span><i className={styles.gnssDot}/>GPS 관측</span>
                <span><i className={styles.estimatedDot}/>삼각 측량</span>
                <span>BYE Cell 기지국 위치 (단말 실측 아님)</span>
                <span className={styles.provenance}>붉은 마커는 정확한 QoE 하락 지점이 아니라 저QoE 통화에 연결된 좌표입니다.</span>
              </div>
            </div>

            <aside className={styles.districtPanel} aria-label="행정동별 저품질 집중 지역">
              <div className={styles.panelHead}>
                <div><h2>행정동별 저품질 집중 지역</h2>
                  <p>위치가 확인되거나 추정된 저QoE 통화 기준</p></div>
                <span className={styles.countBubble}>{fmt(model.regions.length)}개 행정동</span>
              </div>
              {district && <button type="button" className={styles.clearDistrict} onClick={()=>selectDistrict(null)}>선택 행정동 해제 ×</button>}
              <div className={styles.districtScroll}>
                {model.regions.length === 0 ? <p className={styles.empty}>현재 조건에 연결된 행정동이 없습니다.</p> :
                  model.regions.map((region,idx) =>
                    <button type="button" key={region.id}
                      className={styles.districtRow}
                      aria-pressed={district===region.id}
                      onClick={()=>selectDistrict(region.id)}
                    >
                      <span className={styles.rankNumber}>{idx+1}</span>
                      <span className={styles.districtStats}>
                        <strong>{region.label}</strong>
                        <span className={styles.districtTrack}>
                          <span style={{width:(100*region.poorCalls/maxArea)+'%'}}/>
                        </span>
                        <small>GPS {fmt(region.gnssCalls)} · 추정 {fmt(region.estimatedCalls)} · 고객 {fmt(region.customerCount)}</small>
                      </span>
                      <strong className={styles.rankCount}>{fmt(region.poorCalls)}건</strong>
                    </button>)}
              </div>
              <p className={styles.sideNote}>MDT는 저QoE 중심 부분표본입니다. 행정동별 전체 통화 대비 불량률은 표시하지 않습니다.</p>
            </aside>
          </section>

          <section className={styles.hourSection} aria-label="시간대별 QoE 품질 분포">
            <div className={styles.panelHead}>
              <div><h2>시간대별 통화 품질</h2>
                <p>파란색: 그 외 유효 QoE 통화 · 빨간색: 저품질 통화</p></div>
              {hour !== null && <button className={styles.clearDistrict} onClick={()=>switchHour(hour)}>{hour}시 선택 해제 ×</button>}
            </div>
            <div className={styles.hourChart}>
              {model.hourly.map((bin)=>{
                const height = 120*bin.evaluated/maxHour;
                const red = bin.poor ? Math.min(height,Math.max(2,120*bin.poor/maxHour)) : 0;
                const blue = Math.max(0,height-red);
                return <button type="button" key={bin.hour} aria-pressed={hour===bin.hour}
                  aria-label={`${String(bin.hour).padStart(2,'0')}시 · 평가 가능 ${fmt(bin.evaluated)}건, 저품질 ${fmt(bin.poor)}건, 미평가 ${fmt(bin.total-bin.evaluated)}건`}
                  title={`${bin.hour}시: 평가 가능 ${bin.evaluated}건 / 저품질 ${bin.poor}건`}
                  onClick={()=>switchHour(bin.hour)}>
                  <span className={styles.hourStack}>
                    <span className={styles.hourRed} style={{height:red+'px'}}/>
                    <span className={styles.hourBlue} style={{height:blue+'px'}}/>
                  </span><span className={styles.hourLabel}>{String(bin.hour).padStart(2,'0')}</span>
                </button>;
              })}
            </div>
            <p className={styles.chartNote}>누적 높이 = 유효 QoE 통화. 미평가 통화는 제외됩니다. 시간대를 선택하면 지도·행정동 순위·통화 목록이 함께 바뀝니다.</p>
          </section>

          <section className={styles.callPanel} aria-label="선택 위치 저품질 통화 목록">
            <div className={styles.panelHead}>
              <div><h2>{district
                ? (model.regionById.get(district)?.label ?? '선택 행정동')+'의 저QoE 통화'
                : '위치 연계 저QoE 통화 목록'}</h2>
                <p>같은 통화가 복수 위치에 있더라도 목록에서는 한 번만 표시합니다.</p></div>
              <span className={styles.countBubble}>{fmt(model.focusedCalls.length)}건</span>
            </div>
            <div className={styles.tableScroll}>
              {model.focusedCalls.length ? <table>
                <thead><tr><th>통화 시작</th><th>위치 행정동</th><th>QoE(v5)</th><th>위치 근거</th><th>확인</th></tr></thead>
                <tbody>{model.focusedCalls.slice(0,limit).map((call)=>{
                  const point = model.markerByCall.get(call.id);
                  return <tr key={call.id} className={selectedCallId===call.id?styles.selectedRow:undefined}>
                    <td>{call.start}</td>
                    <td>{point ? model.regionById.get(point.areaId)?.label ?? '행정동 미확인' : '—'}</td>
                    <td><span className={styles.poorMos}>{call.mos?.toFixed(2) ?? '—'} · {grades(call.mos)}</span></td>
                    <td>{point?.evidence==='gnss'?'GPS 관측':point?.evidence==='bye-cell'?<span title={byeSelectionDescription(point)}>BYE 기지국(UE 좌표 아님) · {byeSelectionDescription(point)}</span>:'삼각 측량'}</td>
                    <td><button type="button" className={styles.inspect}
                      onClick={() => setSelectedCallId(call.id)}>통화 분석</button></td>
                  </tr>;
                })}</tbody>
              </table> : <p className={styles.empty}>현재 선택 범위에 저QoE 통화 위치가 없습니다. 시간·위치 근거·행정동 필터를 확인하세요.</p>}
            </div>
            {model.focusedCalls.length>limit && <button type="button" className={styles.loadMore}
              onClick={()=>setLimit((current)=>current+20)}>더 보기 ({fmt(model.focusedCalls.length-limit)}건 남음)</button>}
          </section>

          {selected && <section className={styles.detailPanel} aria-label="선택 통화 품질 근거">
            <div className={styles.panelHead}>
              <div><h2>선택 통화 · 원본 QoE(v5) {selected.mos?.toFixed(3) ?? '미평가'}</h2>
                <p>{selected.start} · {selectedLocation
                  ? (model.regionById.get(selectedLocation.areaId)?.label ?? '행정동 미확인')+
                    ' · '+(selectedLocation.evidence==='gnss'?'GPS 관측':selectedLocation.evidence==='bye-cell'?'BYE 기지국(UE 좌표 아님)':'삼각 측량') : '연계 위치 없음'}</p></div>
              <div className={styles.detailActions}>
                <Link href={buildOriginalCallLink(selected,date)}>고객·통화 분석 원본 열기</Link>
                <button type="button" onClick={()=>setSelectedCallId(null)}>닫기</button>
              </div>
            </div>
            {selectedLocation?.byeRuId&&<p data-bye-selection={selectedLocation.byeSelectionMethod??'unknown'}>
              BYE 기지국 선택: {byeSelectionDescription(selectedLocation)} · 기지국 참고 위치
            </p>}
            {detail.loading && <p className={styles.state}>CDR·RTP·MDT 근거를 불러오는 중…</p>}
            {detail.error && <p className={styles.error}>{detail.error}</p>}
            {detail.day && selectedDayCall &&
              <MosCallInvestigation call={selectedDayCall} samples={detail.day.samples}/>}
            {detail.day && !selectedDayCall && <p className={styles.error}>선택 통화를 고객 상세 자료에서 찾지 못했습니다.</p>}
          </section>}
          <div className={styles.caution}>
            <strong>데이터 해석 주의</strong> SIP CDR의 QoE(v5)는 통화 단위 지표입니다. 위치 마커는
            해당 저QoE 통화와 연결된 GPS 또는 삼각 측량 위치이며, 정확한 품질 저하 순간의 위치를 증명하지 않습니다.
            MDT는 QoE 3 미만 통화 중심의 부분표본이고 삼각 측량 정확도는 검증되지 않았습니다.
            행정동 SHP 경계 기준일: {overview.boundaryBaseDate?.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')}.
          </div>
        </>}
      </main>
    </div>
  );
}

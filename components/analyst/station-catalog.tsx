'use client';

import {useEffect,useMemo,useState} from 'react';
import {Search,RadioTower,ChevronLeft,ChevronRight,RefreshCw} from 'lucide-react';
import {QualityTopNav} from './quality-top-nav';
import {AnalystMap} from './analyst-map';
import {filterStationRows,stationFromRow,stationCatalogTechnology,validateStationCatalog,type StationCatalog,type StationRow,type StationTechnology} from '../../lib/analyst/station-catalog';
import styles from './station-catalog.module.css';

const PAGE_SIZE=50;
const n=(value:number)=>value.toLocaleString('ko-KR');
const statusLabel={valid:'등록',missing:'미제공',invalid:'범위 확인',conflict:'등록값 충돌'};
export function StationCatalogWorkspace(){
  const [technology,setTechnology]=useState<StationTechnology>('LTE');
  const [catalog,setCatalog]=useState<StationCatalog|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [query,setQuery]=useState(''),[pci,setPci]=useState(''),[page,setPage]=useState(0),[selected,setSelected]=useState<StationRow|null>(null);
  const isNr=technology==='NR',radioLabel=isNr?'5G (NR)':'LTE';
  const chooseTechnology=(next:StationTechnology)=>{
    if(next===technology)return;
    setTechnology(next);setCatalog(null);setError('');setSelected(null);
    setQuery('');setPci('');setPage(0);
  };
  useEffect(()=>{
    const controller=new AbortController();
    void fetch(technology==='NR'?'/qoe/nr-station-catalog.json':'/qoe/station-catalog.json',{signal:controller.signal,cache:'no-cache'})
      .then(response=>{if(!response.ok)throw new Error('기지국 목록을 불러오지 못했습니다.');return response.json();})
      .then(value=>{
        if(controller.signal.aborted)return;
        const data=validateStationCatalog(value);
        if(stationCatalogTechnology(data)!==technology)throw new Error('선택한 LTE/5G와 기지국 자료가 일치하지 않습니다.');
        setCatalog(data);setSelected(data.rows[0]??null);
      })
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'기지국 목록을 확인해 주세요.');});
    return ()=>controller.abort();
  },[technology,attempt]);
  const rows=useMemo(()=>filterStationRows(catalog?.rows??[],query,pci,technology),[catalog,query,pci,technology]);
  const pageCount=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
  const currentPage=Math.min(page,pageCount-1);
  const visible=rows.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
  // Filtering cannot leave the detail map pointing at a hidden previous result.
  const focused=selected&&rows.includes(selected)?selected:rows[0]??null;
  const stations=useMemo(()=>focused&&catalog?[stationFromRow(focused,catalog.source.file,technology)]:[],[focused,catalog,technology]);
  const reusedCount=useMemo(()=>focused?.[2]!=null?catalog?.rows.filter(row=>row[2]===focused[2]).length??0:0,[catalog,focused]);
  const observations=catalog?.observations;
  return <div className={styles.workspace}>
    <QualityTopNav active="stations" sourceLabel={catalog?radioLabel+' 인벤토리 · '+(catalog.source.fileDate??catalog.source.file):radioLabel+' 인벤토리'}/>
    <main className={styles.main}>
      <div className={styles.heading}><div><h1>기지국·PCI</h1><p>LTE·5G 기지국을 찾고, 선택한 셀의 등록 위치와 PCI를 확인합니다.</p></div>
        {catalog&&<span className={styles.file}>{catalog.source.file}</span>}</div>
      <div className={styles.technologyBar}>
        <fieldset className={styles.technology} aria-label="기지국 통신 방식">
          <button type="button" aria-pressed={technology==='LTE'} onClick={()=>chooseTechnology('LTE')}>LTE</button>
          <button type="button" aria-pressed={technology==='NR'} onClick={()=>chooseTechnology('NR')}>5G (NR)</button>
        </fieldset>
        <span>{radioLabel} 등록 PCI 범위 0~{isNr?'1007':'503'} · 목록과 지도는 선택한 통신 방식 기준입니다.</span>
      </div>
      {error?<div className={styles.error} role="alert">{error}<button onClick={()=>{setError('');setAttempt(value=>value+1);}}><RefreshCw size={14}/>다시 불러오기</button></div>:!catalog?<output>기지국 목록을 불러오는 중입니다.</output>:<>
        <section className={styles.metrics} aria-label="기지국 인벤토리 요약">
          <div><span>{radioLabel} 등록 셀 · RU+Cell</span><strong>{n(catalog.summary.registeredCells)}</strong><small>유효 식별자·좌표 기준 · 제외 {n(catalog.summary.invalidRows)}행</small></div>
          <div><span>PCI 등록 셀</span><strong>{n(catalog.summary.withPci)}</strong><small>미제공 {n(catalog.summary.missingPci)} · 오류·충돌 {n(catalog.summary.invalidPci+catalog.summary.conflictingPci)}</small></div>
          <div><span>등록 PCI 종류</span><strong>{n(catalog.summary.distinctPci)}</strong><small>PCI는 여러 셀에서 재사용됩니다.</small></div>
          <div><span>관측·등록 PCI 비교</span><strong>{observations?n(observations.comparable):'—'}<em>건</em></strong><small>{observations?'일치 '+n(observations.matched)+' · 불일치 '+n(observations.mismatched):isNr?'현재 MDT는 LTE · 5G 관측 비교 미제공':'MDT 비교 집계 미제공'}</small></div>
        </section>
        <div className={styles.columns}>
          <section className={styles.panel} aria-label="기지국 검색 및 목록">
            <div className={styles.search}>
              <label><span>RU / Cell 검색</span><div><Search size={16}/><input aria-label="RU 또는 Cell 검색" placeholder="RU 또는 Cell ID" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/></div></label>
              <label><span>PCI</span><input aria-label="PCI 검색" inputMode="numeric" placeholder={isNr?'0~1007':'0~503'} value={pci==='missing'?'':pci} onChange={event=>{setPci(event.target.value);setPage(0);}}/></label>
              <button className={pci==='missing'?styles.active:undefined} onClick={()=>{setPci(pci==='missing'?'':'missing');setPage(0);}}>PCI 미확인</button>
            </div>
            <div className={styles.listTitle}><h2>기지국 목록 <span>{n(rows.length)}</span></h2><small>행을 선택하면 등록 위치를 표시합니다.</small></div>
            <div className={styles.tableWrap}><table><thead><tr><th>RU ID</th><th>Cell ID</th><th>등록 PCI</th><th>확인</th></tr></thead><tbody>
              {visible.map(row=><tr key={technology+'\0'+row[0]+'\0'+row[1]} className={focused===row?styles.selected:undefined} onClick={()=>setSelected(row)}>
                <td><button aria-label={'기지국 선택 '+row[0]+' '+row[1]} onClick={()=>setSelected(row)}>{row[0]}</button></td><td>{row[1]}</td><td className={styles.pci}>{row[2]??'—'}</td><td>{statusLabel[row[5]]}</td>
              </tr>)}
              {!visible.length&&<tr><td colSpan={4} className={styles.noResults}>조건에 맞는 기지국이 없습니다.</td></tr>}
            </tbody></table></div>
            <div className={styles.pagination}><span>{rows.length?n(currentPage*PAGE_SIZE+1)+'–'+n(Math.min((currentPage+1)*PAGE_SIZE,rows.length)):'0'} / {n(rows.length)}</span><div>
              <button aria-label="기지국 이전 페이지" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}><ChevronLeft size={15}/></button>
              <span>{n(currentPage+1)} / {n(pageCount)}</span>
              <button aria-label="기지국 다음 페이지" disabled={currentPage===pageCount-1} onClick={()=>setPage(currentPage+1)}><ChevronRight size={15}/></button>
            </div></div>
          </section>
          <aside className={styles.details}>
            <section className={styles.panel}><div className={styles.detailTitle}><RadioTower size={17}/><h2>선택 기지국</h2><span>등록 좌표</span></div>
              <div className={styles.map}>{focused?<AnalystMap stations={stations} showStations showGnss={false} showEstimates={false} focusKey={'station-catalog-'+technology} focusTarget={{key:technology+'/'+focused[0]+'/'+focused[1],lat:focused[3],lon:focused[4]}}/>:<p className={styles.note}>검색 결과가 없어 표시할 기지국이 없습니다.</p>}</div>
              {focused&&<dl><div><dt>통신 방식</dt><dd>{radioLabel}</dd></div><div><dt>RU ID</dt><dd>{focused[0]}</dd></div><div><dt>Cell ID</dt><dd>{focused[1]}</dd></div><div><dt>등록 PCI</dt><dd>{focused[2]??'미제공'}</dd></div><div><dt>동일 PCI 등록 셀</dt><dd>{focused[2]!=null?n(reusedCount)+'개 ('+radioLabel+')':'—'}</dd></div><div><dt>위도 / 경도</dt><dd>{focused[3].toFixed(6)} / {focused[4].toFixed(6)}</dd></div><div><dt>주파수</dt><dd>원본 미제공</dd></div></dl>}
              <p className={styles.note}>기지국 좌표는 고객 위치가 아닙니다. 동일 PCI의 재사용만으로 간섭·충돌을 판단할 수 없습니다.</p>
            </section>
            <section className={styles.panel}><div className={styles.audit}><h2>MDT 비교 범위</h2>
              {observations?<><p>{observations.dates[0]} ~ {observations.dates.at(-1)} · LTE CDR 연계 MDT</p><dl><div><dt>전체 관측</dt><dd>{n(observations.total)}건</dd></div><div><dt>RU+Cell 정확 일치</dt><dd>{n(observations.exactMatched)}건</dd></div><div><dt>등록 셀 미확인</dt><dd>{n(observations.unregistered)}건</dd></div><div><dt>일치 셀 중 PCI 비교 불가</dt><dd>{n(observations.unavailable)}건</dd></div></dl></>:<p>{isNr?'MDT 무선 관측은 LTE입니다. 5G 관측 PCI·GPS 자료는 없으며, SIP CDR의 5G 종료 Cell은 현황에서 BYE 기지국 참고 위치로 표시합니다. 복수 후보는 MDT 장비 일치 우선, 없으면 첫 후보를 사용합니다.':'MDT 관측 집계가 없습니다.'}</p>}
              <p className={styles.note}>측정일과 인벤토리 파일 날짜가 다릅니다. 고객·통화 분석에서 관측 원값과 비교 근거를 확인할 수 있습니다.</p>
            </div></section>
          </aside>
        </div>
      </>}
    </main>
  </div>;
}

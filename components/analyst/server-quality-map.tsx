'use client';
import {useMemo,useState} from 'react';
import {AnalystMap} from './analyst-map';
import {MapPanelFrame} from './map-panel-frame';
import qualityTheme from './quality-status-theme.module.css';
import {QualityMapPanelHeading} from './quality-summary-panels';
import {buildImprovedView} from '../../lib/analyst/improved-overview';
import {detailStationMarkersForMap} from '../../lib/analyst/quality-map-stations';
import type {AnalystDay,OverviewCallLocation} from '../../lib/analyst/types';
import type {VoiceMap,VoiceMapStations,VoiceScope} from '../../lib/analyst/server-query';
import type {BaseStation} from '../../lib/location-estimation/types';
import styles from './quality-proposal-four.module.css';

const EMPTY_STATIONS:BaseStation[]=[];

export default function ServerQualityMap({value,scope,onSelectCall,onSelectArea,onEvidenceChange,stationsVisible,stationLayer,stationError,onToggleStations,suspended=false,focus}:{
  value:VoiceMap;scope:VoiceScope;onSelectCall:(id:string)=>void;onSelectArea:(id:string|null)=>void;
  onEvidenceChange:(evidence:'all'|'gnss'|'estimated')=>void;stationsVisible:boolean;onToggleStations:()=>void;suspended?:boolean;
  stationLayer:VoiceMapStations|null;stationError:string|null;
  focus:{key:string;lat:number;lon:number}|null;
}){
  const view=useMemo(()=>buildImprovedView(value.overview,{from:scope.from,to:scope.to,hour:scope.hour??null,
    districtId:scope.district??null,evidence:scope.evidence??'all',band:scope.band??'poor'}),[value,scope]);
  const stations=stationsVisible?(stationLayer?.stations??EMPTY_STATIONS):EMPTY_STATIONS;
  const locations=useMemo(()=>{
    if(!stationsVisible||!stationLayer)return view.locations;
    const references=new Map(stationLayer.locations.map(point=>[point.callId,point]));
    return view.locations.map(point=>({...point,...references.get(point.callId)}));
  },[stationsVisible,stationLayer,view.locations]);
  return <MapPanelFrame className={styles.panel+' '+qualityTheme.mapPanel} label="통화 종료 위치 지도" suspended={suspended}>
    {({toggleButton})=><>
      <QualityMapPanelHeading band={scope.band??null} mode={scope.distributionMode??'mos'} evidence={scope.evidence??'all'}
        onEvidenceChange={onEvidenceChange} stationsVisible={stationsVisible} stationCount={value.stationCount??stationLayer?.stationCount??0}
        onToggleStations={onToggleStations} toggleButton={toggleButton}/>
      <div className={styles.mapHost} data-map-surface><AnalystMap source="MDT" scoreBand={scope.band??'poor'}
        administrativeDongs={value.overview.administrativeDongs} cells={view.mapCells} callLocations={locations}
        stations={stations} showStations={stationsVisible} hideByeSiteMarkers clusterOccurrences
        separateEvidence={scope.evidence!=='all'} unifiedOccurrenceBubbles={scope.evidence==='all'}
        focusKey={'server-quality-'+JSON.stringify(scope)} focusTarget={focus} selectedCellId={scope.district}
        onCellSelect={onSelectArea} onCallLocationSelect={onSelectCall}/></div>
      <div className={styles.mapFoot+' '+qualityTheme.mapFooter}>
        <div><span className={scope.evidence==='all'?styles.bubbleDot:styles.gnssDot}/>GPS {view.locations.filter(point=>point.evidence==='gnss').length.toLocaleString('ko-KR')}건</div>
        <div><span className={scope.evidence==='all'?styles.bubbleDot:styles.trilatDot}/>삼각 측량 대략 위치 후보 {view.locations.filter(point=>point.evidence==='estimated').length.toLocaleString('ko-KR')}건</div>
        <div><span className={styles.outlineDot}/>행정동 경계</div>
        <details className={qualityTheme.mapCriteria}><summary>위치 표시 기준</summary>
          <p>GPS 중 종료 60~180초 전 마지막 실측 {view.locations.filter(point=>point.positionQuality==='gnss-last-known').length.toLocaleString('ko-KR')}건은 종료 실측 위치가 아닌 참고점입니다.</p>
          <p>지도에 표시된 위치 {view.locations.length.toLocaleString('ko-KR')}건 · GPS 및 삼각 측량 근사만 표시 · BYE 기지국 참고점 제외 · 실제 불량 순간 위치 확정 아님</p>
        </details>
        <span className={qualityTheme.mapScope}>지도 위치 {view.locations.length.toLocaleString('ko-KR')}건 · GPS 및 삼각 측량 근사 · 실제 불량 순간 위치 확정 아님</span>
        {stationsVisible&&stationError&&<small role="alert">기지국 자료 조회 실패: {stationError}</small>}
      </div>
    </>}
  </MapPanelFrame>;
}

export function SelectedCallMap({day,rawCallId,location}:{day:AnalystDay;rawCallId:string;location?:OverviewCallLocation}){
  const samples=useMemo(()=>day.samples.filter(s=>s.callId===rawCallId),[day,rawCallId]);
  const [selected,setSelected]=useState<number|null>(null);
  if(!samples.some(s=>s.lat!==null&&s.lon!==null)&&!location)return <p>연결 가능한 위치 관측이 없습니다.</p>;
  const stations=!samples.some(s=>s.lat!==null&&s.lon!==null)&&location?detailStationMarkersForMap(location):day.baseStations;
  return <div className={styles.dialogLocationMap}><AnalystMap source="MDT" samples={samples} stations={stations}
    callLocations={location?[location]:[]} showStations selectedIndex={selected} onSampleSelect={setSelected}
    focusKey={'selected-'+rawCallId} emphasizeLocationSource/></div>;
}

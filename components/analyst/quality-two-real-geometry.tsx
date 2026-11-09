'use client';
import type {QualityCandidateDetail} from '../../lib/analyst/quality-improvement-candidates';
import {SIM_NEIGHBOR_EPS_M,SIM_DISPLAY_MARGIN_M} from '../../lib/analyst/quality-two-simulation';
import styles from './quality-two-simulator.module.css';
export function QualityTwoRealGeometry({detail}:{detail:QualityCandidateDetail}){
 const candidate=detail.candidate;
 const members=candidate.nearbyPoints.filter(p=>p.role==='discovery-member'&&Number.isFinite(p.lat)&&Number.isFinite(p.lon));
 if(!members.length)return null;
 const center=candidate.medoid;
 const latitudeRadian=center.lat*Math.PI/180;
 const metric=members.map(p=>({...p,px:(p.lon-center.lon)*111320*Math.cos(latitudeRadian),py:(p.lat-center.lat)*111320}));
 const cx=195,cy=160;
 // Include the entire 100m circle around every approved observation in the SVG bounds.
 const extentX=Math.max(candidate.displayRadiusM,...metric.map(p=>Math.abs(p.px)+SIM_NEIGHBOR_EPS_M));
 const extentY=Math.max(candidate.displayRadiusM,...metric.map(p=>Math.abs(p.py)+SIM_NEIGHBOR_EPS_M));
 const scale=Math.min(166/Math.max(extentX,1),122/Math.max(extentY,1));
 let pair:[number,number]|null=null,max=0;
 for(let i=0;i<metric.length;i++)for(let j=i+1;j<metric.length;j++){
  const d=Math.hypot(metric[i].px-metric[j].px,metric[i].py-metric[j].py);
  if(d>max){pair=[i,j];max=d;}
 }
 const x=(p:{px:number})=>cx+p.px*scale,y=(p:{py:number})=>cy-p.py*scale;
 return <div className={styles.realScene} aria-label="선택 실제 후보 관측점과 조사 반경 그림">
  <svg viewBox="0 0 390 321" aria-label="실제 관측점별 100m 이웃 원과 대표점의 최종 조사 원">
   <rect x="0" y="0" width="390" height="321" rx="10" fill="#f8fcff"/>
   <path d="M15 160 H375 M195 30 V292" stroke="#dce8ef" strokeDasharray="4 4" strokeWidth="1"/>
   {metric.map(p=><circle key={'eps-'+p.callId} data-circle-kind="neighbor" data-point-id={p.callId}
    cx={x(p)} cy={y(p)} r={SIM_NEIGHBOR_EPS_M*scale} fill="#35b4a3" fillOpacity=".03"
    stroke="#2aa58f" strokeOpacity=".7" strokeDasharray="4 4" strokeWidth="1.2"/>)}
   <circle data-circle-kind="final" cx={cx} cy={cy} r={candidate.displayRadiusM*scale}
    fill="#f5b041" fillOpacity=".08" stroke="#d97706" strokeWidth="2.4"/>
   {pair&&<line x1={x(metric[pair[0]])} y1={y(metric[pair[0]])} x2={x(metric[pair[1]])} y2={y(metric[pair[1]])} stroke="#7851a2" strokeWidth="2.1" strokeDasharray="4 3"/>}
   {metric.map((p,i)=><g key={p.callId}><circle cx={x(p)} cy={y(p)} r="9" fill={p.kind==='gnss'?'#218db5':'#8c78c2'} stroke="#fff" strokeWidth="2"/>
    <text x={x(p)} y={y(p)+3} fontSize="9" fill="#fff" fontWeight="850" textAnchor="middle">{i+1}</text>
   </g>)}
   <circle cx={cx} cy={cy} r="5" fill="#075e58" stroke="#fff" strokeWidth="2"/>
   <path d={`M${cx} ${cy+8} V${cy+20} H${cx+6}`} fill="none" stroke="#086f66" strokeWidth="2"/>
   <text x={cx+10} y={cy+25} fontSize="10" fill="#08786b" fontWeight="850">대표점</text>
   <text x="13" y="19" fontWeight="850" fill="#2e5b75" fontSize="12">선택된 실제 저QoE 관측점 분포</text>
   <rect x="12" y="290" width="366" height="23" rx="6" fill="#e8f3f7"/>
   <text x="22" y="306" fontSize="10" fill="#496c83">청록 점선=각 점의 100m 이웃 · 주황 실선=최종 조사 원</text>
  </svg>
  <div className={styles.realLegend} aria-label="실제 후보 원의 종류 설명">
   <span><i className={styles.neighborCircle}/> 관측점마다 100m 이웃 검색 원</span>
   <span><i className={styles.finalCircle}/> 대표점 기준 최종 원 {candidate.displayRadiusM}m</span>
   <span><i style={{background:'#218db5'}}/>GPS</span>
   <span><i style={{background:'#8c78c2'}}/>검토 통과 삼각 측량</span>
   <span><i style={{background:'#08786b'}}/>대표점</span>
  </div>
  <div className={styles.circleMath} aria-label="실제 후보 최종 조사 원 계산">
   <b>표시 반경 = max(100m, 대표점→최원거리 + {SIM_DISPLAY_MARGIN_M}m)을 10m 단위 올림</b>
   <span>대표점→최원거리 {candidate.maxCenterDistanceM.toFixed(1)}m + {SIM_DISPLAY_MARGIN_M}m → 최종 {candidate.displayRadiusM}m</span>
   <span>전체 구성점 간 최대 거리 {candidate.maxPairDistanceM.toFixed(1)}m · 범위 검토 {candidate.rangeReviewRequired?'필요':'불필요'}</span>
  </div>
  <p>실제 승인된 위치를 평면 투영한 개념도입니다. 100m 이웃 검색 원은 지도에서 최종 표시하는 원이 아닙니다. 지도 표시 반경은 GPS 오차 또는 실제 QoE 열화 순간의 위치 정확도를 의미하지 않습니다.</p>
 </div>;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const file=fs.readFileSync('components/analyst/quality-proposal-four.tsx','utf8');

test('overview mode buttons use the requested short labels without changing mapMode identifiers',()=>{
 assert(file.includes("onClick={()=>{setMapMode('current');setChosenCall(null);setDialogOpen(false);}}>품질현황</button>"));
 assert(file.includes("onClick={()=>{setMapMode('improvement');setChosenCall(null);setDialogOpen(false);}}>개선후보</button>"));
 assert(!file.includes('>기존 현황</button>'));
 assert(!file.includes('>개선 후보 분석</button>'));
});
test('QoE KPI retains its original numeric calculation, removes Drop adjustment visual qualifiers',()=>{
 assert(file.includes("{name:'평균 QoE',value:number(metrics.mean),sub:'MOS(v5) 기반'"));
 assert(file.includes("const metrics=useMemo("));
 assert(file.includes('MDT · QoE · 저품질'));
 assert(!file.includes("name:'평균 QoE (Drop 보정)'"));
 assert(!file.includes("sub:'MOS(v5) 기반 · 절단 −2.5점'"));
 assert(!file.includes('QoE(Drop 보정)'));
});
test('distribution title and accessibility label change, SIP Drop dropdown/calculation remains intact',()=>{
 assert(file.includes('title="QoE 분포"'));
 assert(file.includes('aria-label="QoE 분포 기준"'));
 assert(!file.includes('title="QoE 점수 분포"'));
 assert(file.includes('<option value="drop">절단 (SIP 상태코드)</option>'));
 assert(file.includes("const scopeOverview=distributionMode==='drop'?dropOverview:displayOverview"));
});
test('map, base-station toggle, district ranking are renamed across quality grade filters',()=>{
 for(const label of ['저품질 통화 위치','보통 통화 위치','양호 통화 위치','저품질 순위','보통 순위','양호 순위']){
   assert(file.includes("'"+label+"'"),label+' missing');
 }
 assert(file.includes('aria-label="기지국 표시 전환"'));
 assert(file.includes(">기지국 {showMapStations?'숨기기':'표시'} · {n(currentStationCount)}곳</button>"));
 assert(!file.includes('저품질 통화 종료 위치 지도'));
 assert(!file.includes('종료 위치 기준 행정동 저품질 순위'));
 assert(!file.includes('aria-label="측위 기지국 표시 전환"'));
});
test('new names do not change raw SIP Drop treatment, MOS thresholds, station toggling, map calculations',()=>{
 assert(file.includes('onClick={()=>setShowMapStations(v=>!v)}'));
 assert(file.includes("setMapMode('current')"));
 assert(file.includes("setMapMode('improvement')"));
 assert(file.includes('QoE < 3.0'));
 assert(file.includes('SIP Drop QoE −2.5점'));
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const root='components/analyst/';
const read=name=>fs.readFileSync(root+name,'utf8');

test('candidate header uses 저품질 경험 while retaining original quality-overview tab',()=>{
 const header=read('quality-improvement-two.tsx');
 const top=read('quality-proposal-four.tsx');
 assert(header.includes('<strong>저품질 경험</strong>'));
 assert(header.includes('<a href="#quality-two-primary">개선후보</a>'));
 assert(!header.includes('저품질 조사 후보'));
 assert(top.includes('>품질현황</button>'));
 assert(top.includes('>개선후보</button>'));
});
test('DBSCAN and all alternative candidate KPI/headings use 개선 and remove 영향 and 지도 from visible titles',()=>{
 const db=read('quality-two-candidate-workspace.tsx');
 const alt=read('quality-model-alternative-workspace.tsx');
 for(const s of [db,alt]){
  assert(s.includes('개선 후보'));
  assert(!s.includes('조사 후보 지역'));
  assert(!s.includes('조사 후보 지도'));
  assert(!s.includes('저품질 영향 고객'));
  assert(s.includes('<ImprovementCandidateMap'));
 }
 assert(db.includes('> 저품질 경험 고객</span>'));
 assert(db.includes('> 개선 후보 지역</span>'));
 assert(db.includes('<MapPinned size={18}/> 개선 후보</h2>'));
 assert(db.includes('개선 후보 지역 목록'));
 assert(db.includes('label="개선 후보 영역"'));
 assert(alt.includes('<MapPinned size={18}/> 개선 후보</h3>'));
 assert(alt.includes('label="대안 모델 개선 후보 영역"'));
 assert(alt.includes('전체 기간 개선 후보'));
});
test('model selector, fullscreen rail, details, and supporting simulator agree',()=>{
 const selector=read('quality-improvement-candidate-panel.tsx');
 const rail=read('quality-investigation-rail.tsx');
 const guide=read('quality-two-algorithm-guide.tsx');
 const simulator=read('quality-two-simulator.tsx');
 const map=read('improvement-candidate-map.tsx');
 const detail=read('quality-summary-panels.tsx');
 assert(selector.includes('개선 후보 산정 모델 선택'));
 assert(selector.includes('전체화면 개선 후보 알고리즘'));
 assert(rail.includes('전체화면 개선 후보 탐색'));
 assert(rail.includes('개선 후보 지역'));
 assert(guide.includes('개선 후보는 어떻게 만들어지나요?'));
 assert(simulator.includes('개선 후보 · 범위 검토 필요'));
 assert(!simulator.includes('최종 조사 원'));
 assert(map.includes('선택 알고리즘의 개선 후보 구성에 사용됐습니다'));
 assert(detail.includes('개선후보 · 통화 상세 목록'));
 assert(detail.includes('개선 필터 해제'));
});
test('source model and customer/rough calculations are not replaced by display text changes',()=>{
 const map=read('quality-two-candidate-workspace.tsx');
 const alt=read('quality-model-alternative-workspace.tsx');
 assert(map.includes('roughUsedForCandidate={usingMixed}'));
 assert(map.includes("selectedMapCandidates"));
 assert(map.includes('GPS '));
 assert(alt.includes('loadAlternativeModelReport(scope,ctrl.signal,analysisMode,locationSource)'));
 assert(!alt.includes('GPS_BANDS.map'));
 assert(alt.includes('roughUsedForCandidate={usingMixed}'));
});

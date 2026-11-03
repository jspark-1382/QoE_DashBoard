const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {formatCallDuration}=load('lib/analyst/call-duration.ts');
const read=p=>fs.readFileSync(p,'utf8');
test('whole-second call duration rounds without exposing floating-point artifacts',()=>{
 for(const [seconds,expected] of [
  [120.59499999999998,'02:01'],
  [0.594999999999,'00:01'],
  [59.49,'00:59'],
  [59.51,'01:00'],
  [121,'02:01'],
  [3599.7,'01:00:00'],
  [7205.5,'02:00:06'],
  [0,'00:00'],
  [null,'미제공'],
  [NaN,'미제공'],
  [-1,'미제공'],
 ])assert.equal(formatCallDuration(seconds),expected,'source '+seconds);
});
test('customer-only map clearly differentiates GNSS, radio, interpolation and BTS; global map unchanged',()=>{
 const contract=read('components/analyst/contract-workspace.tsx');
 const map=read('components/analyst/analyst-map.tsx');
 const right=read('components/analyst/observation-details.tsx');
 const css=read('components/analyst/contract-workspace.module.css');
 const mapCss=read('components/analyst/analyst-map.module.css');
 assert(contract.includes('return formatCallDuration(s)'));
 assert(contract.includes('title={Number.isFinite(c.durationSeconds)'));
 assert(contract.includes('emphasizeLocationSource'));
 for(const name of ['GNSS 관측','무선 추정','보간 추정','기지국','이동 위치 근거']){
  assert(contract.includes(name));
 }
 assert(contract.includes('observedPoints.length===0'));
 assert(contract.includes('고객 위치 출처 요약'));
 assert(contract.includes('selectedPosition'));
 assert(contract.includes('지도 위치 출처 범례'));
 assert(contract.includes('빨간 테두리는 선택 품질 지표 저하'));
 assert(map.includes('emphasizeLocationSource = false'));
 assert(map.includes("s.locationSource==='radio'?'#6754c7'"));
 assert(map.includes("s.locationSource==='interpolated'?'#d38e28':'#098e83'"));
 assert(map.includes("qualityPoor?'#d84747'"));
 assert(map.includes('sourceName'));
 assert(map.includes('GNSS/실측 관측'));
 assert(mapCss.includes('.sourceDiamond span'));
 assert(css.includes('.positionBadges'));
 assert(right.includes('data-location-source={sample.locationSource}'));
 assert(right.includes('고객 추정 위치 · 무선 측량'));
 assert(right.includes('고객 위치 계산 불가 · 무선 근거만'));
});

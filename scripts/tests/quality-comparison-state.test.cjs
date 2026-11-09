/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
test('comparison state round trips multiple customers and every investigation filter',()=>{
 assert.ok(fs.existsSync('lib/analyst/quality-comparison-state.ts'),'comparison state adapter exists');
 const {parseQualityComparisonState,qualityComparisonHref}=load('lib/analyst/quality-comparison-state.ts');
 const dates=['2026-10-29','2026-10-30'];
 const parsed=parseQualityComparisonState('?dateStart=2026-10-29&dateEnd=2026-10-30&from=09:00&to=18:00&customer=a&customer=b&customer=a&selectedBand=fair&distributionMode=drop&selectedHour=11&district=x&evidence=gnss&cohort=repeat&mapMode=improvement&chosenCall=c&sourceRevision=r&sipFilter=drop&search=hello',dates);
 assert.equal(parsed.ok,true);assert.deepEqual(parsed.state.customerIds,['a','b']);
 assert.equal(parsed.state.sipFilter,'drop');assert.equal(parsed.state.search,'hello');
 assert.deepEqual(parseQualityComparisonState(qualityComparisonHref(parsed.state,'improvement1').split('?')[1],dates).state,parsed.state);
 assert.equal(parseQualityComparisonState('',dates).state.dateStart,'2026-10-30');
 assert.equal(parseQualityComparisonState('?dateStart=2026-10-30&dateEnd=2026-10-29',dates).error,'date-range');
 assert.equal(parseQualityComparisonState('?from=20:00&to=10:00',dates).error,'time-range');
 assert.equal(parseQualityComparisonState('?variant=wrong',dates).error,'variant');
});

/* eslint-disable @typescript-eslint/no-require-imports -- Local Node evidence tests. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCandidateComparisonDraft}=require('../qwen-candidate-comparison-draft.cjs');
test('compact prompt preserves original comparison sources/denominators, period and no raw model target bodies',()=>{
 const pair={category:'coverage',evidenceIds:['T02','T14'],survey:{percent:55,evidenceId:'T02'},peers:[{percent:5,evidenceId:'T14'}]};
 const context={schemaVersion:'candidate-comparison-input-v1',scope:{candidateCalls:5},gridComparisons:[pair],
  callObservations:[{category:'equipment',indicator:'rtpTermination',evidenceIds:['T01'],assessableCalls:1,matchedCalls:1}],
  callOverlap:[{indicators:['dl','rtpTermination'],assessableForBoth:0,sameCalls:0}],radioCriteriaCoverage:{dl:{matchedCalls:1,assessableCalls:2}}};
 const scope={dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'};
 const draft=createCandidateComparisonDraft({scope,comparisonContext:context,analysisTargets:[{id:'private-target'}],sop:{steps:'private-sop'},
  limitations:['private-log'],facts:[{id:'T01',detail:'private-diagnostic'}]});
 assert.deepEqual(JSON.parse(draft.user),{scope,comparisonContext:context});
 assert(!draft.user.includes('private-'));
 assert.match(draft.system,/cause-comparison-v1/);
 assert.match(draft.system,/sameCalls/);
 assert.match(draft.system,/assessableForBoth/);
 assert.match(draft.system,/RTP/);
 assert.match(draft.system,/두 결과/);
 assert.equal(typeof draft.system,'string');
});

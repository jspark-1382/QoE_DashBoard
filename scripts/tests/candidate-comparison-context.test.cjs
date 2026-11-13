/* eslint-disable @typescript-eslint/no-require-imports -- Candidate analysis evidence tests. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildCandidateComparisonContext}=require('../qwen-candidate-comparison-context.cjs');
const {boundCandidateModelInput}=require('../qwen-candidate-model-scope.cjs');
const {publicCandidateEvidence}=require('../qwen-candidate-public-evidence.cjs');
const date='2026-11-03';
const grid=(id,percent,earfcn='475',weight=100)=>({id:'grid-'+id,kind:'mdt-grid',evidenceIds:[id],sourceDates:[date],band:'2.1',earfcn,
 metrics:{samples:200,belowPct:{'-100':percent},metricSamples:{'-100':weight}}});
const radio=(id,alias,linked,criteria)=>({id,kind:'call-criteria',evidenceIds:[alias],callIds:[linked],sourceDates:['2026-10-28'],
 metrics:{criteria:Object.fromEntries(Object.entries(criteria).map(([field,status])=>[field,{status}]))}});
function collect(targets,links=[],survey=[],calls=[]){
 const model={analysisTargets:targets,coveragePointTargetIds:survey,neighbourLinks:links,summary:{totalCalls:calls.length},
  transmission:[],limitations:[],facts:targets.flatMap(t=>t.evidenceIds.map(id=>({id})))};
 const findings={analysisTargets:targets.map(t=>({...t,callIds:t.callIds??[],mapPoints:[]}))};
 model.comparisonContext=buildCandidateComparisonContext(model,findings,calls);
 return {model,findings,context:model.comparisonContext};
}
test('ground same-carrier/grid contrasts at the DL criterion using all supported immediate peers, including weak peers and real zero',()=>{
 const targets=[grid('T01',55.6),grid('T02',7.31),grid('T03',60),grid('T04',0),grid('T05',91,'3743'),grid('T06',99,'475',3),grid('T07',99)];
 const links=targets.slice(1).map((t,i)=>['T01',t.evidenceIds[0],'북쪽',i===5?35.36:25]);
 const {context,model,findings}=collect(targets,links,['grid-T01']);
 const row=context.gridComparisons[0];
 assert.equal(row.thresholdDbm,-100);assert.equal(row.survey.percent,55.6);
 assert.deepEqual(row.peers.map(p=>p.percent),[7.31,60,0]);
 assert.equal(row.neighborMeanPct,22.44);assert.equal(row.gapPp,33.16);
 assert.deepEqual(row.evidenceIds,['T01','T02','T03','T04']);
 assert.equal(row.category,'coverage');
 const bounded=boundCandidateModelInput(model,findings,1000,1).modelInput;
 const retained=new Set(bounded.analysisTargets.flatMap(t=>t.evidenceIds));
 assert(row.evidenceIds.every(e=>retained.has(e)));
});
test('public numeric reading faithfully follows the model pair, separates grid from call and survives saving',()=>{
 const grids=[grid('T01',55.6),grid('T02',7.31),grid('T03',5.28)];
 const criteria=[radio('R1','T04','private-A',{dl:'matched',overlap:'matched'}),radio('R2','T05','private-B',{dl:'not-matched',overlap:'not-matched'})];
 const term={id:'TERM1',kind:'termination-group',evidenceIds:['T06'],callIds:['private-B'],metrics:{rawCodes:{byeReasonRaw:'RTP timeout'}}};
 const {context,model,findings}=collect([...grids,...criteria,term],[['T01','T02','북쪽',25],['T01','T03','동쪽',25]],['grid-T01'],[{id:'private-A'},{id:'private-B'}]);
 const evidence={...findings,modelInput:model,facts:model.facts,versions:{prompt:'candidate-prompt-v11'}};
 const primary={category:'coverage',evidenceIds:context.gridComparisons[0].evidenceIds};
 const alt={category:'interference',evidenceIds:['T04']};
 const report={comparison:{schemaVersion:'cause-comparison-v1',primary,alternative:alt}};
 const projected=publicCandidateEvidence(evidence,report);
 const reading=projected.comparisonReading;
 assert.deepEqual(reading.primary,primary);assert.deepEqual(reading.alternative,alt);
 assert.match(reading.text,/2\.1 GHz.*55\.60%.*25m.*6\.30%.+셀 복귀.*1\/2/);
 assert(!reading.text.includes('동시'));assert(!JSON.stringify(reading).includes('private-'));
 assert.deepEqual(publicCandidateEvidence(projected,report).comparisonReading,reading);
 const dl={category:'coverage',evidenceIds:['T04']},rtp={category:'equipment',evidenceIds:['T06']};
 const paired=publicCandidateEvidence(evidence,{comparison:{...report.comparison,primary:dl,alternative:rtp}}).comparisonReading;
 assert.match(paired.text,/DL 약전계.*1\/2.+RTP 종료.*1\/1.+같은 통화.*0\/1/);
 const broken={comparison:{...report.comparison,alternative:{...alt,evidenceIds:['T99']}}};
 assert.equal(publicCandidateEvidence(evidence,broken).comparisonReading,undefined);
 assert.equal(publicCandidateEvidence(projected,broken).comparisonReading,undefined);
 assert.equal(publicCandidateEvidence(evidence).comparisonReading,undefined);
});
test('differentiate matched, assessed and missing calls; compare overlaps by actual call identity without exposing IDs',()=>{
 const a='private-call-a',b='private-call-b',c='private-call-c';
 const targets=[radio('R1','T01',a,{dl:'matched',frequencyChange:'matched'}),radio('R2','T02',b,{dl:'not-matched',frequencyChange:'insufficient'}),
 radio('R3','T03',c,{dl:'insufficient',frequencyChange:'not-matched'}),
 {id:'TERM1',kind:'termination-group',evidenceIds:['T04'],callIds:[b],metrics:{rawCodes:{byeReasonRaw:'102^RTP timeout'}}}];
 const calls=[{id:a,radioSeries:[{rsrp:-100,servingPci:0,neighbors:[{pci:3,rsrp:-102}]}]},{id:b,radioSeries:[{rsrp:-88,servingPci:0,neighbors:[]}]},{id:c,radioSeries:[]}];
 const {context}=collect(targets,[],[],calls);
 const dl=context.callObservations.find(row=>row.indicator==='dl');
 assert.equal(dl.matchedCalls,1);assert.equal(dl.assessableCalls,2);assert.deepEqual(dl.evidenceIds,['T01']);
 assert.equal(context.scope.sampledRadioReports,2);assert.equal(context.scope.reportsWithServingAndNeighborRsrp,1);
 const relation=(a,b)=>context.callOverlap.find(row=>row.indicators.includes(a)&&row.indicators.includes(b)).sameCalls;
 assert.equal(relation('dl','frequencyChange'),1);assert.equal(relation('frequencyChange','rtpTermination'),0);
 assert.equal(context.callOverlap.find(row=>row.indicators.includes('frequencyChange')&&row.indicators.includes('rtpTermination')).assessableForBoth,0);
 assert(!JSON.stringify(context).includes('private-call-'));
});

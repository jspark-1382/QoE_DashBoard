/* eslint-disable @typescript-eslint/no-require-imports -- Native Node read-only context API regressions. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createCandidateFixture}=require('./qwen-candidate-fixture.cjs');
const {createQwenAnalysisHandler}=require('../qwen-analysis-api.cjs');

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-pot-context-')),f=createCandidateFixture(root);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 f.detail.calls[0].endCellId='unique';f.detail.calls[1].endCellId='ambiguous';f.detail.calls[2].endCellId='missing';
 fs.writeFileSync(f.detailPath,JSON.stringify(f.detail));
 const basis={latPerX:0,lonPerX:0.0000113,latPerY:0.000009,lonPerY:0};
 const rows=Array.from({length:9},(_,i)=>{
  const pot=i===7?'38507_77757':'38507_'+(77750+i);
  return {pot,x:1000,y:1000+i*25,lat:37.5+i*.0001,lon:127.05,rsrp:-90,samples:100,bands:{'900':[-90,100]},displayDate:'2026-11-03',
   analysis:[{date:'2026-11-03',band:'900',earfcn:'3743',samples:100,rsrpMean:-90,rsrqMean:-14,phrMean:null,rsrpMeanSumCnt:-88,
    belowPct:{'-85':90,'-90':50,'-95':30,'-100':20,'-105':i===7?1:i===8?0:50,'-110':i===8?0:1},
    metricSamples:{rsrpMean:100,rsrqMean:100,phrMean:0,rsrpMeanSumCnt:100,'-85':100,'-90':100,'-95':100,'-100':100,'-105':100,'-110':100},sourceFiles:['data/fixture.xlsx']}]};
 });
 rows.push({...rows[0],pot:'outside',lat:38});
 const base={schemaVersion:'mdt-25m-rsrp-grid-v1',source:'fixture.xlsx',sourceDate:'2026-11-03',sourceDates:['2026-11-03'],sources:[{file:'data/fixture.xlsx',sourceRows:10,acceptedRows:10,duplicateRows:0}],cellSizeM:25,referenceOnly:true,gridCells:rows.length,sourceRows:10,measurements:1000,basisPerMeter:basis,inputSignature:'grid-fixture',metricWeightBasis:'O열 집계 가중치 · 실제 지표 분모 미확인'};
 const analysis={...base,analysisSchemaVersion:'mdt-grid-analysis-v1',records:rows};
 const display={...base,records:rows.map(({analysis:_analysis,...p})=>p)};
 f.write('quality-improvement/mdt-grid-analysis-v1.json',analysis);f.write('quality-improvement/mdt-grid-25m-v1.json',display);
 f.write('station-catalog.json',{schemaVersion:'lte-station-catalog-v1',source:{file:'registry.xlsx',fileDate:'2026-11-04'},observations:{sourceRevision:'old-revision'},rows:[
  ['ru-one','unique',192,37.501,127.051,'valid'],
  ['ru-two','ambiguous',77,37.5,127.05,'valid'],
  ['ru-three','ambiguous',77,37.52,127.06,'valid'],
  ['ru-reference','near',12,37.5005,127.0505,'valid'],
  ['ru-far','far',15,38,128,'valid'],
 ]});
 return {...f,analysis,display};
}
const collect=f=>require('../candidate-pot-context.cjs').collectCandidatePotContext({publicDir:f.publicDir,target:f.target,sourceRevision:f.sourceRevision});
async function apiFixture(t){
 const f=fixture(t),handler=createQwenAnalysisHandler({root:f.root,env:{},collectEvidence:()=>{throw new Error('Qwen evidence collection must not run');}});
 const server=http.createServer((req,res)=>{void handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await handler.close();await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});});
 const request=async(body=f.target,headers={},method='POST')=>{
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/qoe/api/analysis/candidate-context',{method,headers:{'Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
 };
 return {...f,request};
}

test('context API works without Qwen configuration or inference and retains every in-range POT',async t=>{
 const f=await apiFixture(t),r=await f.request();
 assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.schemaVersion,'candidate-pot-context-v1');
 assert.equal(r.body.pots.length,9);
 assert(r.body.pots.some(p=>p.pot==='38507_77757'));
 assert(r.body.pots.some(p=>p.analysis[0].belowPct['-105']===0));
 assert(!r.body.pots.some(p=>p.pot==='outside'));
 assert.deepEqual(r.body.target,f.target);
 assert.equal(r.body.grid.metricWeightBasis,f.analysis.metricWeightBasis);
 assert.deepEqual(r.body.pots.find(p=>p.pot==='38507_77757').analysis[0].sourceFiles,['data/fixture.xlsx']);
 assert.equal(r.body.model,undefined);assert.equal(r.body.report,undefined);
});

test('ambiguous BYE registrations keep all positions without nearest-cell promotion',t=>{
 const f=fixture(t),r=collect(f);
 const unique=r.stations.filter(s=>s.cellId==='unique'),ambiguous=r.stations.filter(s=>s.cellId==='ambiguous');
 assert.equal(unique.length,1);assert.equal(unique[0].relation,'candidate-bye');
 assert.equal(ambiguous.length,2);assert(ambiguous.every(s=>s.relation==='ambiguous-bye'));
 assert(ambiguous.some(s=>s.lat===37.52),'far matching registration must not be silently discarded');
 assert.equal(r.stations.find(s=>s.cellId==='near').relation,'nearby-inventory');
 assert.equal(r.stations.find(s=>s.cellId==='near').callCount,0);
 assert(!r.stations.some(s=>s.cellId==='far'));
 assert.equal(r.stationSummary.uniqueCells,1);
 assert.deepEqual(r.stationSummary.ambiguousCells,['ambiguous']);
 assert.deepEqual(r.stationSummary.missingCells,['missing']);
 assert.equal(r.stationSummary.sourceDate,'2026-11-04');
 assert.match(r.limitations.join(' '),/책임|원인/);
 assert(!JSON.stringify(r).includes('old-revision'),'old observation statistics must not become current evidence');
});

test('scope, revision, candidate and client-supplied member overrides are rejected',async t=>{
 const f=await apiFixture(t);
 let r=await f.request({...f.target,sourceRevision:'older'});assert.equal(r.status,409);assert.equal(r.body.code,'STALE_REVISION');
 r=await f.request({...f.target,candidateScope:{...f.target.candidateScope,scopeKey:'wrong'}});assert.equal(r.status,409);assert.equal(r.body.code,'CANDIDATE_SCOPE_MISMATCH');
 r=await f.request({...f.target,candidateId:'absent'});assert.equal(r.status,404);
 r=await f.request({...f.target,memberCallIds:['override']});assert.equal(r.status,400);
 r=await f.request({...f.target,scope:{...f.target.scope,from:'12:00'}});assert.equal(r.status,409);
});

test('context endpoint preserves same-origin, content-type and method guards',async t=>{
 const f=await apiFixture(t);
 assert.equal((await f.request(f.target,{Origin:'https://unrelated.example'})).status,403);
 assert.equal((await f.request(f.target,{'Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal((await f.request(f.target,{'Content-Type':'text/plain'})).status,415);
 assert.equal((await f.request(f.target,{},'GET')).status,405);
});

test('missing grid is explicit unavailable and missing candidate position fails',t=>{
 const f=fixture(t);
 fs.unlinkSync(path.join(f.publicDir,'quality-improvement/mdt-grid-analysis-v1.json'));
 fs.unlinkSync(path.join(f.publicDir,'quality-improvement/mdt-grid-25m-v1.json'));
 const r=collect(f);assert.equal(r.grid.status,'unavailable');assert.deepEqual(r.pots,[]);assert.equal(r.grid.basisPerMeter,null);
 f.detail.candidate.medoid.lat=null;fs.writeFileSync(f.detailPath,JSON.stringify(f.detail));
 assert.throws(()=>collect(f),e=>e.code==='CANDIDATE_EVIDENCE_MISMATCH');
});

test('file mtime and content changes invalidate cached fingerprints',t=>{
 const f=fixture(t),first=collect(f),same=collect(f);
 assert.equal(first.fingerprint,same.fingerprint);
 const file=path.join(f.publicDir,'station-catalog.json'),stat=fs.statSync(file);
 fs.utimesSync(file,new Date(),new Date(stat.mtimeMs+10000));
 const touched=collect(f);assert.notEqual(touched.fingerprint,first.fingerprint);
 f.analysis.records[7].analysis[0].belowPct['-105']=2;
 f.write('quality-improvement/mdt-grid-analysis-v1.json',f.analysis);
 const edited=collect(f);assert.notEqual(edited.fingerprint,touched.fingerprint);
 assert.equal(edited.pots.find(p=>p.pot==='38507_77757').analysis[0].belowPct['-105'],2);
});

test('nearby references are capped without clipping related ambiguous positions',t=>{
 const f=fixture(t),file=path.join(f.publicDir,'station-catalog.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8'));
 for(let i=0;i<150;i++)catalog.rows.push(['ref-'+i,'unrelated-'+i,2,37.5003+i*.000001,127.05,'valid']);
 fs.writeFileSync(file,JSON.stringify(catalog));
 const r=collect(f);assert.equal(r.stations.filter(s=>s.relation==='nearby-inventory').length,100);
 assert.equal(r.stations.filter(s=>s.relation==='ambiguous-bye').length,2);
});

test('date and per-metric denominators remain separate and zero is not missing',t=>{
 const f=fixture(t),r=collect(f),a=r.pots.find(p=>p.pot==='38507_77757').analysis[0];
 assert.equal(a.date,'2026-11-03');assert.deepEqual(r.grid.measurementDates,['2026-11-03']);
 assert.equal(a.rsrpMean,-90);assert.equal(a.rsrpMeanSumCnt,-88);
 assert.equal(a.phrMean,null);assert.equal(a.metricSamples.phrMean,0);
 assert.equal(r.pots.find(p=>p.analysis[0].belowPct['-105']===0).analysis[0].belowPct['-110'],0);
});

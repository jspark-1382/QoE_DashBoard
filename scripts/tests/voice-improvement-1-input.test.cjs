// Historical source assertions use the preserved original cohort; current sources have a separate census test.
const {historicalRead,historicalJson}=require('./published-fixture.cjs');
/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const builderPath=path.resolve(__dirname,'../build-voice-improvement-1-input.cjs');
test('input builder exists before source ingestion can be enabled',()=>assert.ok(fs.existsSync(builderPath),'isolated input builder is not implemented'));
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-improvement-input-'));
  const publicDir=path.join(dir,'public'),outDir=path.join(dir,'outputs');fs.mkdirSync(publicDir);
  const put=(name,value)=>{const target=path.join(publicDir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value));};
  const call={id:'raw',start:'12:00:00',end:'12:00:10',startTimestamp:'2026-10-26T12:00:00+09:00',endTimestamp:'2026-10-26T12:00:10+09:00',mos:2,mosV5Original:2,qoe:2,mosStatus:'VALID',matchStatus:'MATCHED',matchDeltaSec:1,hasMdt:true,mdtCount:1};
  const row=Array(22).fill(null);row[0]=43205;row[1]='12:00:05';row[2]=37;row[3]=127;row[19]='raw';row[21]={gnss:true,timestamp:'2026-10-26T12:00:05+09:00',inCallWindow:true};
  put('detail.json',{key:'synthetic:2026-10-26',customerId:'synthetic',date:'2026-10-26',samples:[row],calls:[call],sampleCount:1});
  put('voice-1030.json',{meta:{revision:'synthetic',source:'MDT',dates:['2026-10-26'],qoeBasis:'rtcp-mos-v5',poorQoeThreshold:3,matching:{note:'unique matching'}},customers:[{id:'synthetic'}],days:[{customerId:'synthetic',date:'2026-10-26',dataPath:'detail.json',sampleCount:1}]});
  put('analyst-overview/MDT/2026-10-26.json',{schemaVersion:'analyst-overview-v1',source:'MDT',date:'2026-10-26',sourceRevision:'synthetic',calls:[{...call,id:'synthetic:raw',rawCallId:'raw',customerId:'synthetic',startSecond:43200}],callLocations:[{callId:'synthetic:raw',evidence:'gnss',lat:37,lon:127,observedAt:'2026-10-26T12:00:05+09:00',cdrEndAt:call.endTimestamp,referenceBasis:'direct-gnss',positionQuality:'gnss-observed'}]});
  return {dir,publicDir,outDir,put,call};
}
test('reads original matching evidence, preserves GNSS, creates lineage and separate artifact',()=>{
  const f=fixture();try{const {buildInput}=require(builderPath);const d=buildInput({publicDir:f.publicDir,outDir:f.outDir});
  assert.equal(d.coverage.N,1);assert.equal(d.coverage.D,1);assert.equal(d.coverage.G,1);assert.equal(d.coverage.T,0);assert.equal(d.decisions[0].kind,'gnss');
  assert.equal(d.calls[0].callId,'2026-10-26:synthetic:raw');assert.ok(d.inputFiles.length>=3);assert.match(d.inputHash,/^[a-f0-9]{64}$/);assert.ok(fs.existsSync(path.join(f.outDir,'input.json')));
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('hasMdt alone is unknown, ambiguous matching cannot enter D',()=>{
  const {mdtLinkStatus}=require(builderPath);
  assert.equal(mdtLinkStatus({hasMdt:true,mdtCount:50}),'unknown');
  assert.equal(mdtLinkStatus({matchStatus:'AMBIGUOUS',hasMdt:true}),'ambiguous');
  assert.equal(mdtLinkStatus({matchStatus:'MATCHED',hasMdt:true,matchDeltaSec:0}),'unique');
  assert.equal(mdtLinkStatus({matchStatus:'MATCHED',hasMdt:false}),'unknown');
});
test('daily time window includes seconds through the end of its final minute like legacy overview',()=>{
  const f=fixture();try{
    const detail=JSON.parse(historicalRead(path.join(f.publicDir,'detail.json'))),overview=JSON.parse(historicalRead(path.join(f.publicDir,'analyst-overview/MDT/2026-10-26.json')));
    detail.calls[0].start='12:00:59';overview.calls[0].startSecond=43259;
    f.put('detail.json',detail);f.put('analyst-overview/MDT/2026-10-26.json',overview);
    assert.equal(require(builderPath).buildInput({publicDir:f.publicDir,outDir:f.outDir,from:'12:00',to:'12:00'}).coverage.N,1);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('wrong source revision, missing detail, inconsistent MOS and unsafe output fail closed',()=>{
  for(const scenario of ['revision','missing','mos','unsafe']){const f=fixture();try{
    if(scenario==='revision'){const o=JSON.parse(historicalRead(path.join(f.publicDir,'analyst-overview/MDT/2026-10-26.json')));o.sourceRevision='other';f.put('analyst-overview/MDT/2026-10-26.json',o);}
    if(scenario==='missing')fs.unlinkSync(path.join(f.publicDir,'detail.json'));
    if(scenario==='mos'){const d=JSON.parse(historicalRead(path.join(f.publicDir,'detail.json')));d.calls[0].mosV5Original=4;f.put('detail.json',d);}
    assert.throws(()=>require(builderPath).buildInput({publicDir:f.publicDir,outDir:scenario==='unsafe'?f.publicDir:f.outDir}),/revision|ENOENT|MOS|output/i);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}}
});

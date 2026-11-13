const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createExportDetailReader}=require('../voice-query-export-details.cjs');
const {load}=require('../analyst-ts-loader.cjs');
test('original radio remains in the call window, keeps RSRQ/PHR zero and strips unrelated metadata',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'targeted-radio-'));
 try{
  const call={id:'call-fixture',start:'10:00:00',end:'10:01:00',matchStatus:'MATCHED',hasMdt:true,rtp:{rxJitter:2},termination:{fcRaw:'9563',byeReasonRaw:'102^RTP timeout'}};
  const sample=(t,rsrq,mdt={})=>{const a=Array(22).fill(null);a[0]=t;a[1]='10:00:01';a[8]='LTE';a[9]=0;a[10]=-99;a[11]=rsrq;a[12]=0;a[19]=call.id;a[21]={timestamp:'2026-10-30T10:00:01.000+09:00',cellId:'001',frequency:3743,phr:0,neighbors:[{pci:0,rsrp:-105,private:'omit'}],streamId:'omit',gnssUtmkx:123,...mdt};return a;};
  const detail={customerId:'fixture',date:'2026-10-30',calls:[call],samples:[sample(36001,-16),sample(36002,null),sample(35999,-5),sample(36003,-1,{inCallWindow:false})]};
  const reader=createExportDetailReader({publicDir:dir,entryFor:()=>detail});
  const r=reader('fixture','2026-10-30',call.id);
  assert.equal(r.rsrq,-16);assert.equal(r.rsrp,-99);assert.equal(r.sinr,0);assert.equal(r.rtp.rxJitter,2);
  assert.equal(r.radioSeries.length,2);assert.equal(r.radioSeries[0].phr,0);assert.equal(r.radioSeries[1].rsrq,null);
  assert.equal(r.radioSeries[0].servingPci,0);assert.equal(r.radioSeries[0].radioTechnology,'LTE');
  assert.deepEqual(r.radioSeries[0].neighbors,[{pci:0,rsrp:-105}]);
  assert(!JSON.stringify(r).includes('omit'));assert(!JSON.stringify(r).includes('gnssUtmkx'));
  assert.equal(r.termination.fcRaw,'9563');assert.equal(r.termination.byeReasonRaw,'102^RTP timeout');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('unmatched radio cannot be presented as call-linked measurements',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'targeted-radio-'));
 try{
  const reader=createExportDetailReader({publicDir:dir,entryFor:()=>({customerId:'fixture',date:'2026-10-30',calls:[{id:'call-fixture',start:'10:00:00',end:'10:01:00',matchStatus:'AMBIGUOUS',rsrq:-7,rtp:{}}],samples:[]})});
  const r=reader('fixture','2026-10-30','call-fixture');assert.equal(r.rsrq,null);assert.deepEqual(r.radioSeries,[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('enriched grid validator preserves legacy files and rejects a fabricated percentage or denominator',()=>{
 const {isValidMdt25mGrid}=load('lib/analyst/mdt-25m-grid.ts');
 const g={schemaVersion:'mdt-25m-rsrp-grid-v1',referenceOnly:true,cellSizeM:25,sourceDate:'2026-11-03',gridCells:1,basisPerMeter:{latPerX:0,lonPerX:.00001,latPerY:.000009,lonPerY:0},records:[{pot:'p',lat:37.5,lon:127,x:1,y:2,rsrp:-95,samples:1,bands:{'900':[-95,1]}}]};
 assert(isValidMdt25mGrid(g));
 g.analysisSchemaVersion='mdt-grid-analysis-v1';g.sourceDates=['2026-11-03'];g.sources=[{file:'f.xlsx',sourceRows:1,acceptedRows:1,duplicateRows:0}];
 g.records[0].analysis=[{date:'2026-11-03',band:'900',earfcn:'3743',samples:1,rsrpMean:-95,rsrqMean:null,phrMean:0,rsrpMeanSumCnt:-96,belowPct:{'-85':100,'-90':100,'-95':100,'-100':0,'-105':0,'-110':null},metricSamples:{rsrpMean:1,rsrqMean:0,phrMean:1,rsrpMeanSumCnt:1,'-85':1,'-90':1,'-95':1,'-100':1,'-105':1,'-110':0},sourceFiles:['f.xlsx']}];
 assert(isValidMdt25mGrid(g));
 g.records[0].analysis[0].belowPct['-100']=110;assert.equal(isValidMdt25mGrid(g),false);
 g.records[0].analysis[0].belowPct['-100']=0;g.records[0].analysis[0].metricSamples.rsrqMean=1;assert.equal(isValidMdt25mGrid(g),false);
});

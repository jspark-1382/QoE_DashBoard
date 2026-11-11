/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const stylePath=path.resolve('components/analyst/gps-marker-style.tsx');
const compiled=ts.transpileModule(fs.readFileSync(stylePath,'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}
}).outputText;
const mod={exports:{}};
vm.runInThisContext('(function(require,module,exports){'+compiled+'\n})',{filename:stylePath})(require,mod,mod.exports);
const {gpsBand,gpsBandLabel,gpsRsrpColor,gpsMarkerSvg,GPS_BANDS}=mod.exports;
const report=JSON.parse(fs.readFileSync('public/quality-improvement/gps-marker-rf-v1.json','utf8'));

test('exact RF evidence is auditable, source-versioned and independent of source files',()=>{
 const index=require('../../public/quality-improvement/index.json');
 assert.equal(report.schemaVersion,'qoe-gps-marker-rf-v1');
 assert.equal(report.sourceRevision,index.sourceRevision);
 assert.equal(report.scope,'approved-low-qoe-gnss');
 assert.equal(Object.keys(report.records).length,131);
 assert.equal(report.stats.matched,131);
 assert.equal(report.stats.missing,0);
 assert.equal(report.stats.red+report.stats.green+report.stats.unknown,131);
 assert.deepEqual(report.stats.bands,{'900':32,'2100':5,'1800-wide':80,'1800-narrow':14});
 for(const [key,rf] of Object.entries(report.records)){
  assert.equal(rf.callId,key);
  assert.equal(Date.parse(rf.observedAt),Date.parse(rf.mdtObservedAt),'timestamp must match exactly');
  assert.equal(rf.sampleDeltaSec,0);
  assert.equal(gpsBand(rf.earfcn),rf.band);
  assert(Number.isFinite(rf.rsrpDbm));
 }
});

test('all GPS marker shapes are circular across bands and the -105 dBm boundary is red',()=>{
 assert.deepEqual(GPS_BANDS.map(x=>x.name),['1.8광','1.8협','900','2.1','기타']);
 for(const [earfcn,expected] of [[1550,'1800-wide'],[1694,'1800-narrow'],[3743,'900'],[475,'2100'],[null,'other'],[2222,'other']]){
  assert.equal(gpsBand(earfcn),expected);
 }
 const shapes=GPS_BANDS.map(x=>gpsMarkerSvg(x.id,-100));
 assert.equal(new Set(shapes).size,1);
 assert(shapes.every(x=>!x.includes('<rect')));
 assert(shapes.every(x=>x.includes('<circle')));
 assert(shapes.every(x=>!x.includes('<path')));
 assert(shapes.every(x=>x.includes('r="11"')));
 assert(shapes.every(x=>x.includes('#16a34a')));
 assert.equal(gpsRsrpColor(-105),'#dc2626');
 assert.equal(gpsRsrpColor(-106),'#dc2626');
 assert.equal(gpsRsrpColor(-104.9),'#16a34a');
 assert.equal(gpsRsrpColor(null),'#94a3b8');
 assert.equal(gpsBandLabel('other'),'기타');
});

test('map uses RF sidecar only when source revision matches and keeps candidate circles separate',()=>{
 const ui=fs.readFileSync('components/analyst/improvement-candidate-map.tsx','utf8');
 const outer=fs.readFileSync('components/analyst/quality-two-candidate-workspace.tsx','utf8');
 assert(ui.includes("data.sourceRevision===sourceRevision"));
 assert(ui.includes("gps-marker-rf-v1.json"));
 assert(ui.includes("gpsMarkerSvg(band,rf?.rsrpDbm)"));
 assert(ui.includes("withQoeBasePath(callEvidenceUrl("));
 assert(ui.includes("kind==='reviewed-radio'")||ui.includes("point.kind==='gnss'"));
 assert(ui.includes("L.circle(p,{"), 'candidate review radius must remain intact');
 assert(outer.includes("sourceRevision={overview.sourceRevision}"));
 assert(!outer.includes('GPS_BANDS.map'));
});

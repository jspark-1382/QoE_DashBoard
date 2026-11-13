/* Active data must reconcile across all tabs, independently of historical regression fixtures. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const {deriveCallQoe}=load('lib/analyst/derived-qoe.ts');
const {isDrop}=require('../build-customer-screening.cjs');
const read=file=>JSON.parse(fs.readFileSync(path.join('public',file),'utf8'));

test('all active source workbooks reconcile to overview, screening, evidence, models and stations',()=>{
 const manifest=read('voice-1030.json');
 const audit=JSON.parse(fs.readFileSync('outputs/voice-1030-quality-report.json','utf8'));
 const expectedFiles=fs.readdirSync('data/MDT_New').filter(n=>!n.startsWith('~$')&&n.endsWith('.xlsx')&&/sip_call|volte\+mdt/i.test(n)).sort();
 assert.deepEqual([...manifest.meta.sourceFiles].sort(),expectedFiles);
 assert.equal(manifest.meta.totalCalls,audit.sourceCdr.publishedCalls);
 assert.equal(manifest.days.reduce((n,d)=>n+d.callCount,0),manifest.meta.totalCalls);
 const declared=manifest.meta.sourceWorkbookAudit;
 assert.equal(declared.cdr.length+declared.mdt.length,expectedFiles.length);
 assert.equal(declared.cdr.reduce((n,s)=>n+s.publishedCalls,0),manifest.meta.totalCalls);
 const customerIds=new Set(manifest.customers.map(c=>c.id)),observedCustomers=new Set();
 assert.equal(customerIds.size,manifest.customers.length);
 let calls=0,poor=0,drops=0,missing=0,poorMos=0,warningMos=0,goodMos=0;
 for(const date of manifest.meta.dates){
  const overview=read('analyst-overview/MDT/'+date+'.json');
  assert.equal(overview.sourceRevision,manifest.meta.revision);
  assert.equal(overview.calls.length,audit.sourceCdr['published_'+date]);
  assert.equal(new Set(overview.calls.map(c=>c.id)).size,overview.calls.length);
  for(const call of overview.calls){
   assert(customerIds.has(call.customerId));observedCustomers.add(call.customerId);
   const score=deriveCallQoe(call.mos,call.sipCause);
   assert.equal(call.qoe,score,'published score must retain original MOS plus existing SIP Drop rule');
   if(score!==null&&score<3)poor++;
   if(isDrop(call.sipCause))drops++;
   if(call.mos===null)missing++;
   else if(call.mos<3)poorMos++;
   else if(call.mos<3.5)warningMos++;
   else goodMos++;
  }
  calls+=overview.calls.length;
  for(const folder of ['three-site-rough','gps-map-stations'])
   assert.equal(read(folder+'/'+date+'.json').sourceRevision,manifest.meta.revision);
 }
 assert.equal(calls,manifest.meta.totalCalls);
 assert.equal(observedCustomers.size,customerIds.size);
 assert.equal(missing,audit.sourceCdr.missingOrInvalidMos);
 assert.equal(poorMos,audit.sourceCdr.poorMos);
 assert.equal(warningMos,audit.sourceCdr.warningMos);
 assert.equal(goodMos,audit.sourceCdr.goodMos);
 const screening=read('customer-screening-data/2026-10-26_2026-10-30.json');
 assert.equal(screening.sourceRevision,manifest.meta.revision);
 assert.deepEqual([screening.audit.calls,screening.audit.poor,screening.audit.drops,screening.audit.customers],
                  [calls,poor,drops,customerIds.size]);
 for(const folder of ['quality-improvement','quality-improvement-full','quality-models','quality-models-full',
  'quality-improvement-mixed-full','quality-improvement-mixed-evaluation','quality-models-mixed-full','quality-models-mixed-evaluation']){
  const index=read(folder+'/index.json');assert.equal(index.sourceRevision,manifest.meta.revision);
  for(const entry of index.entries){
   assert.equal(entry.scope.sourceRevision,manifest.meta.revision);
   assert.equal(read(folder+'/'+entry.path).scope.sourceRevision,manifest.meta.revision);
  }
 }
 const evidence=read('quality-improvement/index.json');
 for(const e of evidence.evidence){
  const day=read('quality-improvement/'+e.path);
  assert.equal(day.censusComplete,true,'only fully verified daily census may omit unlinked records');
  assert.equal(day.revision,manifest.meta.revision);
 }
 for(const file of ['gps-marker-rf-v1.json','candidate-mdt-rsrp-v1.json'])
  assert.equal(read('quality-improvement/'+file).sourceRevision,manifest.meta.revision);
});

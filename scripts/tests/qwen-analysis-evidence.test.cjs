/* eslint-disable @typescript-eslint/no-require-imports -- The local Node test runner loads CommonJS. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {collectEvidence,validateTarget}=require('../qwen-analysis-evidence.cjs');
const {validateReport}=require('../qwen-analysis-client.cjs');

const revision='fixture-revision';
const target={kind:'customer',customerId:'private-customer-alpha',sourceRevision:revision,scope:{dateStart:'2026-10-26',dateEnd:'2026-10-27',from:'00:00',to:'23:59'}};
function fixture(t,extra=0){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-evidence-')),publicDir=path.join(root,'public'),dbPath=path.join(root,'voice.sqlite');
 fs.mkdirSync(publicDir);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const db=new DatabaseSync(dbPath);
 db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE calls(id TEXT PRIMARY KEY,raw_id TEXT,customer_id TEXT,date TEXT,start_second REAL,mos REAL,qoe REAL,is_drop INTEGER,cell TEXT,area TEXT,end_second REAL,json TEXT);
 CREATE TABLE locations(call_id TEXT,kind TEXT,evidence TEXT,area TEXT,lat REAL,lon REAL,json TEXT,PRIMARY KEY(call_id,kind));
 CREATE TABLE days(customer_id TEXT,date TEXT,json TEXT,PRIMARY KEY(customer_id,date));
 CREATE TABLE areas(id TEXT PRIMARY KEY,label TEXT);
 CREATE INDEX calls_customer_date ON calls(customer_id,date,start_second);`);
 db.prepare('INSERT INTO meta VALUES (?,?)').run('dataset',JSON.stringify({revision,qoeBasis:'rtcp-mos-v5',dates:['2026-10-26','2026-10-27','2026-10-28']}));
 const rows=[
 ['a','2026-10-26',0,2,2,0,'CELL-A','bye-cell'],
 ['b','2026-10-26',86399.5,4,1.5,1,'CELL-A',''],
 ['c','2026-10-26',36000,null,null,1,'CELL-B',''],
 ['d','2026-10-26',36600,4.5,4.5,0,'CELL-B','gnss'],
 ['e','2026-10-26',37200,1,-1.5,1,'CELL-A','estimated'],
 ['f','2026-10-26',37800,8,null,0,'CELL-C',''],
 ['g','2026-10-27',0,3,3,0,'CELL-B','gnss'],
 ['outside','2026-10-28',0,1,1,0,'CELL-A','']];
 for(let i=0;i<extra;i++)rows.push(['extra-'+i,'2026-10-26',40000+i,2,2,0,'CELL-'+i,'']);
 const insert=db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
 for(const [raw,date,second,mos,qoe,drop,cell,evidence] of rows){
  const id=target.customerId+':'+raw;
  insert.run(id,raw,target.customerId,date,second,mos,qoe,drop,cell,'area-a',second+10,JSON.stringify({contractId:'PRIVATE-CONTRACT-991112233',customerId:target.customerId,start:'10:00:00',end:'10:00:10'}));
  if(evidence)db.prepare('INSERT INTO locations VALUES (?,?,?,?,?,?,?)').run(id,'original',evidence,'area-a',37.123456,127.987654,JSON.stringify({evidence,lat:37.123456,lon:127.987654}));
 }
 insert.run('other:call','call','other','2026-10-26',36000,1,1,0,'CELL-A','area-a',36010,'{}');
 db.prepare('INSERT INTO locations VALUES (?,?,?,?,?,?,?)').run(target.customerId+':c','view','estimated','area-a',37,127,'{}');
 db.prepare('INSERT INTO areas VALUES (?,?)').run('area-a','테스트동');
 const calls=rows.filter(r=>r[1]==='2026-10-26').map(([id])=>({id,start:'10:00:00',end:'10:00:10',matchStatus:id==='a'||id==='d'?'MATCHED':'UNMATCHED',hasMdt:true,rsrp:id==='a'?-110:id==='d'?-90:null,sinr:id==='a'?-3:id==='d'?15:null,rtp:{txPacketLoss:id==='a'?2:id==='d'?0:null,txJitter:id==='a'?30:id==='d'?2:null,rxPacketLoss:null,rxJitter:null}}));
 db.prepare('INSERT INTO days VALUES (?,?,?)').run(target.customerId,'2026-10-26',JSON.stringify({customerId:target.customerId,date:'2026-10-26',sourceContractId:'PRIVATE-CONTRACT-991112233',calls,samples:[]}));
 db.close();
 return {root,dbPath,publicDir,target,sourceRevision:revision};
}
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('full customer denominator includes missing MOS Drop and unlocated calls while raw MOS stays separate',t=>{
 const f=fixture(t),before=digest(f.dbPath),e=collectEvidence(f);
 assert.deepEqual(e.summary,{totalCalls:7,evaluatedCalls:5,poorCalls:3,poorRate:.6,rawMosEvaluatedCalls:5,rawMosPoorCalls:2,meanMos:2.9,meanQoe:1.9,dropCalls:3,observedDays:2,poorDays:1});
 assert.deepEqual(e.byDay,[{date:'2026-10-26',totalCalls:6,evaluatedCalls:4,poorCalls:3,dropCalls:3},{date:'2026-10-27',totalCalls:1,evaluatedCalls:1,poorCalls:0,dropCalls:0}]);
 assert.equal(e.coverage.locationCalls,4); // view-only estimated position must not become original evidence.
 assert.equal(e.coverage.radioCalls,2);assert.equal(e.coverage.rtpCalls,2);
 assert.equal(e.coverage.fullPopulation,true);assert.equal(digest(f.dbPath),before);
 assert.ok(e.calls.some(c=>c.qoe===-1.5));assert.ok(e.calls.some(c=>c.qoe===null&&c.isDrop));
});

test('server percentage evidence accepts observed Cell rate prose while rejecting invented quantities',t=>{
 const f=fixture(t),db=new DatabaseSync(f.dbPath);
 db.exec('DELETE FROM locations; DELETE FROM calls; DELETE FROM days;');
 const insert=db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
 const cells=[['CELL-A',511,508,27],['CELL-B',196,196,8],['CELL-C',90,89,5],['',21,21,1]];
 for(const [cellIndex,[cell,total,evaluated,poor]] of cells.entries())for(let i=0;i<total;i++){
  const raw='rate-'+cellIndex+'-'+i,qoe=i<poor?2:i<evaluated?4:null;
  insert.run(target.customerId+':'+raw,raw,target.customerId,'2026-10-26',i,qoe,qoe,0,cell,'area-a',i+10,'{}');
 }
 db.close();
 const e=collectEvidence(f);
 assert.equal(e.modelInput.summary.poorRatePercent,5);
 assert.equal(e.modelInput.summary.poorRate,41/814);
 assert.deepEqual(e.modelInput.byCell.map(row=>row.poorRatePercent),[5.3,4.1,5.6,4.8]);
 assert.deepEqual(e.modelInput.byCell.map(row=>row.poorRate),[27/508,8/196,5/89,1/21]);
 assert.equal(e.modelInput.byCell[3].cell,'Cell 미확인');
 assert.equal(Object.hasOwn(e.summary,'poorRatePercent'),false);
 assert.ok(e.byCell.every(row=>!Object.hasOwn(row,'poorRatePercent')));
 // The rate strings below reproduce the rejected live response.
 const report={summary:'Cell별 저QoE 비율은 4~5.6%로 큰 편차가 없어 특정 셀 집중 패턴은 약합니다.',
  hypotheses:[{title:'특정 대표 Cell에 저QoE가 집중',assessment:'possible',reason:'Cell 01에 저QoE 27건이 가장 많으나, Cell별 저QoE 비율(4.1~5.6%)이 유사하여 통화량 차이에 비례한 분포로 보입니다. Cell은 통화 대표 근거일 뿐 원인 기지국 확정이나 동일 위치 집단 대조가 아닙니다.',evidenceIds:['E05','E01']}],
  checks:[{action:'동일 Cell을 사용하는 다른 고객·다른 시간대 대조군 확보',reason:'Cell 01의 저QoE 비율이 해당 고객 고유의 것인지 Cell 공통 현상인지 구분 필요',evidenceIds:['E05']}],
  limitations:['관측된 연관성과 확인 대상만 제시하며, 전파·망·단말·코어 원인을 확정하거나 설정값 변경을 승인하지 않습니다.']};
 assert.deepEqual(validateReport(report,e),report);
 const unsupported=structuredClone(report);unsupported.summary+=' 지터가 999ms입니다.';
 assert.throws(()=>validateReport(unsupported,e),error=>error.code==='QWEN_UNSUPPORTED_NUMBER');
});

test('model percentages retain null evaluation and rate endpoints',t=>{
 const f=fixture(t);
 for(const [raw,rate,percent] of [['c',null,null],['a',1,100],['g',0,0]]){
  const e=collectEvidence({...f,target:{...target,kind:'call',callId:target.customerId+':'+raw}});
  assert.equal(e.modelInput.summary.poorRatePercent,percent);
  assert.equal(e.modelInput.byCell[0].poorRatePercent,percent);
  assert.equal(e.modelInput.summary.poorRate,rate);
  assert.equal(e.modelInput.byCell[0].poorRate,rate);
 }
});

test('last minute includes fractional seconds and time interval is applied on every date',t=>{
 const f=fixture(t);
 const last=collectEvidence({...f,target:{...target,scope:{...target.scope,from:'23:59',to:'23:59'}}});
 assert.equal(last.summary.totalCalls,1);assert.equal(last.summary.dropCalls,1);
 const midnight=collectEvidence({...f,target:{...target,scope:{...target.scope,from:'00:00',to:'00:00'}}});
 assert.equal(midnight.summary.totalCalls,2);assert.equal(midnight.summary.poorCalls,1);
});

test('single call cannot escape selected customer or period and original detail link uses raw call ID',t=>{
 const f=fixture(t),one=collectEvidence({...f,target:{...target,kind:'call',callId:target.customerId+':b'}});
 assert.equal(one.summary.totalCalls,1);assert.equal(one.calls.length,1);
 const url=new URL(one.calls[0].href,'http://localhost');
 assert.equal(url.searchParams.get('customer'),target.customerId);assert.equal(url.searchParams.get('call'),'b');
 for(const callId of ['other:call',target.customerId+':outside'])assert.throws(()=>collectEvidence({...f,target:{...target,kind:'call',callId}}),e=>e.status===404&&e.code==='NO_CALLS');
});

test('strict target rejects absent identity, invalid calendar/time, reversed range and revision mismatch',t=>{
 for(const value of [null,{}, {...target,customerId:''},{...target,customerId:'x\u0000y'},{...target,kind:'call'}, {...target,sourceRevision:'../rev'}, {...target,scope:{...target.scope,dateStart:'2026-02-30'}},{...target,scope:{...target.scope,dateStart:'2026-10-28'}},{...target,scope:{...target.scope,from:'24:00'}},{...target,scope:{...target.scope,from:'12:00',to:'11:59'}}])assert.throws(()=>validateTarget(value),e=>e.status===400);
 const f=fixture(t);
 assert.throws(()=>collectEvidence({...f,sourceRevision:'different'}),e=>e.status===409&&e.code==='STALE_REVISION');
 assert.throws(()=>collectEvidence({...f,target:{...target,sourceRevision:'different'},sourceRevision:'different'}),e=>e.status===409&&e.code==='STALE_REVISION');
});

test('bounded representative details do not truncate full counts or disclose personal identifiers to model',t=>{
 const f=fixture(t,60),e=collectEvidence(f),model=JSON.stringify(e.modelInput);
 assert.equal(e.summary.totalCalls,67);assert.ok(e.calls.length<=32);assert.equal(e.coverage.sampledCalls,e.calls.length);
 assert.equal(e.byCell.reduce((sum,c)=>sum+c.totalCalls,0),67);assert.ok(e.byCell.length<=13);
 assert.equal(e.modelInput.byCell.at(-1).cell,'기타 Cell 합계');
 assert.equal(e.modelInput.byCell.at(-1).poorRatePercent,96.1);
 for(const forbidden of [target.customerId,'PRIVATE-CONTRACT-991112233','37.123456','127.987654','raw_id','href','customerId'])assert.equal(model.includes(forbidden),false,forbidden);
 assert.ok(model.length<64000);assert.ok(e.facts.every(f=>/^E\d{2}$/.test(f.id)));
 assert.deepEqual(e.facts,collectEvidence(f).facts);
});

test('missing Cell identity stays unknown in model input instead of becoming a named cell',t=>{
 const f=fixture(t),db=new DatabaseSync(f.dbPath);db.exec("UPDATE calls SET cell=''");db.close();
 const e=collectEvidence(f);
 assert.equal(e.byCell[0].cell,'미확인');assert.equal(e.modelInput.byCell[0].cell,'Cell 미확인');
 assert.equal(e.modelInput.byCell[0].poorRatePercent,60);
 assert.ok(e.facts.find(f=>f.id==='E05').detail.includes('미확인'));
});

test('SINR comparison remains available when RSRP is absent and does not claim all radio evidence is missing',t=>{
 const f=fixture(t),db=new DatabaseSync(f.dbPath),row=db.prepare('SELECT json FROM days').get(),detail=JSON.parse(row.json);
 for(const call of detail.calls)call.rsrp=null;
 db.prepare('UPDATE days SET json=?').run(JSON.stringify(detail));db.close();
 const e=collectEvidence(f),fact=e.facts.find(f=>f.id==='E07');
 assert.equal(e.coverage.radioCalls,2);assert.match(fact.detail,/SINR.*-3.*15/);
 assert.equal(fact.title,'표본 내 저QoE·정상 무선 비교');
});

test('unavailable source detail is explicit and does not erase full population evidence',t=>{
 const f=fixture(t),db=new DatabaseSync(f.dbPath);
 db.prepare('UPDATE days SET json=?').run(JSON.stringify({customerId:target.customerId,date:'2026-10-26',dataPath:'../outside.json'}));db.close();
 const e=collectEvidence(f);
 assert.equal(e.summary.totalCalls,7);assert.equal(e.coverage.radioCalls,0);assert.ok(e.limitations.some(x=>x.includes('상세')&&x.includes('읽')));
});

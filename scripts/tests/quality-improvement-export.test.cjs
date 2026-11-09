/* eslint-disable @typescript-eslint/no-require-imports -- Shared Node test harness. */
const test=require('node:test'),assert=require('node:assert/strict');
const {splitReport}=require('../export-quality-improvement.cjs');
test('split summary stays light and scope observations do not depend on candidate IDs',()=>{
 const call={date:'2026-10-26',callId:'2026-10-26:mdt-a:call-1',customerId:'mdt-a',mdtLinkStatus:'unique',mos:2};
 const report={scope:{sourceRevision:'rev',dateStart:call.date,dateEnd:call.date,from:'00:00',to:'23:59'},sourceRevision:'rev',scopeKey:'key',policy:{locationPolicy:'strict-3-site-v1'},calls:[call],decisions:[{callId:call.callId,status:'accepted',kind:'gnss',lat:37.5,lon:127,reasons:[]}],improvedSpatialCandidates:[],discoveryDates:[call.date],validationDates:[]};
 const output=splitReport(report,'audit');assert.ok(Buffer.byteLength(JSON.stringify(output.summary))<=1024*1024);assert.equal(output.summary.candidates.length,0);assert.equal(output.observations.length,1);assert.equal(output.evidence.records.length,1);assert.equal('calls' in output.summary,false);
 report.calls.push({...call,callId:'unknown',mdtLinkStatus:'unknown'});report.decisions.push({callId:'unknown',status:'excluded',reasons:['mdt-unknown']});assert.equal(splitReport(report,'audit').evidence.records.length,1);
});
test('sparse omission means none only after exact original overview census proof',()=>{
 const {proveEvidenceCensus}=require('../export-quality-improvement.cjs');
 const date='2026-10-26',call={callId:date+':mdt-a:call-1',date,mdtLinkStatus:'unique'};
 const report={sourceRevision:'rev',scope:{dateStart:date,dateEnd:date,from:'00:00',to:'23:59'},calls:[call],decisions:[{callId:call.callId,status:'accepted'}]};
 const overview={sourceRevision:'rev',date,calls:[{id:'mdt-a:call-1'}]};
 assert.equal(proveEvidenceCensus(report,overview),true);
 assert.equal(proveEvidenceCensus(report,{...overview,sourceRevision:'old'}),false);
 assert.equal(proveEvidenceCensus(report,{...overview,calls:[]}),false);
 assert.equal(proveEvidenceCensus({...report,calls:[{...call,mdtLinkStatus:'unknown'}]},overview),false);
 assert.equal(proveEvidenceCensus({...report,decisions:[]},overview),false);
});


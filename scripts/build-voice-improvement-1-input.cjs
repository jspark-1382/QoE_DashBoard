/* eslint-disable @typescript-eslint/no-require-imports */
// Reads original overview and call-matching partitions. Never regenerates either source.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parseArgs}=require('node:util');
const {load}=require('./analyst-ts-loader.cjs');
const ROOT=path.resolve(__dirname,'..');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
function safeOutput(publicDir,outDir){
  if(inside(outDir,publicDir)||(inside(publicDir,outDir)&&!inside(path.join(publicDir,'voice-improvement-1'),outDir)))throw Error('Unsafe output overlaps original public inputs');
  if(fs.existsSync(outDir)&&fs.lstatSync(outDir).isSymbolicLink())throw Error('Unsafe output symlink');
}
function mdtLinkStatus(call){
  if(call.matchStatus==='AMBIGUOUS')return 'ambiguous';
  if(call.matchStatus==='UNMATCHED')return 'none';
  // Explicit matching state from the original bijective matcher + finite timing delta.
  if(call.matchStatus==='MATCHED'&&call.hasMdt===true&&Number.isFinite(call.matchDeltaSec))return 'unique';
  return 'unknown';
}
function buildInput(options={}){
  const publicDir=path.resolve(options.publicDir||process.env.QOE_PUBLIC_DIR||path.join(ROOT,'public'));
  const outDir=path.resolve(options.outDir||path.join(ROOT,'outputs/voice-improvement-1-input'));
  safeOutput(publicDir,outDir);
  const hashes=new Map();
  function read(relative){
    const file=path.resolve(publicDir,relative);if(!inside(publicDir,file))throw Error('Source path escapes public directory');
    const bytes=fs.readFileSync(file);hashes.set(relative.replaceAll('\\','/'),digest(bytes));return JSON.parse(bytes);
  }
  const dataset=read('voice-1030.json'),revision=dataset.meta.revision;
  if(typeof revision!=='string'||!revision||dataset.meta.source!=='MDT'||dataset.meta.qoeBasis!=='rtcp-mos-v5')throw Error('Original source revision/MDT MOS basis unavailable');
  const {parseImprovementScope,analysisScope,canonicalScopeJson,DEFAULT_CANDIDATE_POLICY}=load(path.join(ROOT,'lib/analyst/voice-improvement-1/scope.ts'));
  const q=new URLSearchParams();
  for(const [key,value] of Object.entries({dateStart:options.dateStart,dateEnd:options.dateEnd,from:options.from,to:options.to,mode:options.mode}))if(value!=null)q.set(key,value);
  const parsed=parseImprovementScope(q.toString(),dataset.meta.dates,revision);if(!parsed.ok)throw Error('Invalid input scope: '+parsed.reason);
  const scope=analysisScope(parsed.scope),policy={...DEFAULT_CANDIDATE_POLICY};
  const canonicalScope=canonicalScopeJson(scope,policy),scopeKey=digest(canonicalScope).slice(0,20);
  const {normalizeDay}=load(path.join(ROOT,'lib/analyst/data.ts'));
  const {selectCandidateEvidence}=load(path.join(ROOT,'lib/analyst/voice-improvement-1/evidence.ts'));
  const {buildCoverage}=load(path.join(ROOT,'lib/analyst/voice-improvement-1/coverage.ts'));
  const dates=dataset.meta.dates.filter(d=>d>=scope.dateStart&&d<=scope.dateEnd).sort();
  const inventorySources=dataset.meta.byeStationInventories||[dataset.meta.stationInventory].filter(Boolean);
  const stationInventories=[];
  for(const declared of inventorySources){
    if(!declared.file||!/^[a-f0-9]{64}$/i.test(declared.sha256||''))throw Error('Inventory hash provenance missing');
    const inventory=path.join(ROOT,'data/BaseStation',path.basename(declared.file));
    const actual=digest(fs.readFileSync(inventory));if(actual!==declared.sha256.toLowerCase())throw Error('Inventory source hash mismatch');
    stationInventories.push({file:declared.file,sha256:actual,technology:declared.technology||'LTE'});
  }
  const inventoryHash=digest(JSON.stringify([...stationInventories].sort((a,b)=>a.file.localeCompare(b.file))));
  const calls=[],decisions=[],seenCalls=new Set(),seenPartitions=new Set();
  const customerById=new Map(dataset.customers.map(c=>[c.id,c]));
  let verifiedGnss=0,rawRadioCalls=0;
  const seconds=value=>Number(value.slice(0,2))*3600+Number(value.slice(3,5))*60;
  for(const date of dates){
    const overviewFile=`analyst-overview/MDT/${date}.json`,overview=read(overviewFile);
    if(overview.sourceRevision!==revision||overview.source!=='MDT'||overview.date!==date||overview.schemaVersion!=='analyst-overview-v1')throw Error('Overview source/date/revision mismatch');
    const overviewCalls=new Map(),locations=new Map();
    for(const c of overview.calls){if(overviewCalls.has(c.id))throw Error('Duplicate overview call identity');overviewCalls.set(c.id,c);}
    for(const location of overview.callLocations||[]){if(locations.has(location.callId))throw Error('Duplicate representative location');locations.set(location.callId,location);}
    const matchedOverview=new Set();
    for(const entry of dataset.days){
      if(entry.date!==date)continue;
      const partitionId=`${date}:${entry.customerId}`;
      if(seenPartitions.has(partitionId))throw Error('Duplicate customer/date partition');seenPartitions.add(partitionId);
      const detail=entry.dataPath?read(entry.dataPath):entry;
      if(detail.customerId!==entry.customerId||detail.date!==date)throw Error('Detail partition identity mismatch');
      const rawById=new Map();for(const c of detail.calls||[]){if(rawById.has(c.id))throw Error('Duplicate raw call identity');rawById.set(c.id,c);}
      // The shared TS strict review also enforces same-call recent-GNSS movement limits.
      const day=normalizeDay({...dataset,customers:customerById.has(entry.customerId)?[customerById.get(entry.customerId)]:[]},detail,'MDT');
      const selected=[];
      for(const raw of detail.calls||[]){
        const originalId=`${entry.customerId}:${raw.id}`,o=overviewCalls.get(originalId);
        if(!o||o.rawCallId!==raw.id||o.customerId!==entry.customerId)throw Error('Overview/detail CDR identity mismatch');
        matchedOverview.add(originalId);
        const originalMos=Object.hasOwn(raw,'mosV5Original')?raw.mosV5Original:raw.mos;
        if(originalMos!==o.mos)throw Error('Original MOS differs between overview and detail');
        if(o.startSecond<seconds(scope.from)||o.startSecond>seconds(scope.to)+59)continue;
        const callId=`${date}:${originalId}`;if(seenCalls.has(callId))throw Error('Duplicate scoped CDR identity');seenCalls.add(callId);
        const evidence={date,callId,rawCallId:raw.id,customerId:entry.customerId,startedAt:raw.startTimestamp||null,endedAt:raw.endTimestamp||null,
          mos:originalMos??null,sipReason:raw.sipCause||null,mdtLinkStatus:mdtLinkStatus(raw),sourceRevision:revision,sourceFile:entry.dataPath||'voice-1030.json',
          overviewSourceFile:overviewFile,start:raw.start,end:raw.end,endCellId:raw.endCellId||'',contractId:detail.sourceContractId||null};
        let gnss=locations.get(originalId)||null;
        if(gnss?.evidence==='gnss'){
          const stamp=Date.parse(gnss.observedAt||'');
          const observed=day.samples.some(s=>s.callId===raw.id&&s.locationSource==='gnss'&&Number.isFinite(stamp)&&s.timestamp===stamp&&Math.abs(s.lat-gnss.lat)<1e-7&&Math.abs(s.lon-gnss.lon)<1e-7);
          if(!observed)throw Error('Overview GNSS cannot be reproduced from original same-call observations');
          verifiedGnss++;
        }else gnss=null;
        if(day.samples.some(s=>s.callId===raw.id&&s.estimation))rawRadioCalls++;
        calls.push(evidence);selected.push({evidence,gnss});
      }
      for(const {evidence,gnss} of selected)decisions.push(selectCandidateEvidence(evidence,gnss,day));
    }
    if(matchedOverview.size!==overviewCalls.size)throw Error('Overview CDR has no original matching partition');
    if(options.progress)console.log(JSON.stringify({date,calls:calls.length,partitions:seenPartitions.size}));
  }
  calls.sort((a,b)=>a.callId.localeCompare(b.callId));decisions.sort((a,b)=>a.callId.localeCompare(b.callId));
  const inputFiles=[...hashes].sort(([a],[b])=>a.localeCompare(b)).map(([file,sha256])=>({file,sha256}));
  const inputHash=digest(JSON.stringify({inputFiles,stationInventories}));
  const coverage=buildCoverage(calls,decisions);
  const document={schemaVersion:'voice-improvement-1-input-v1',sourceRevision:revision,scope,scopeKey,canonicalScope,policy,availableDates:[...dataset.meta.dates].sort((a,b)=>a.localeCompare(b)),
    calls,decisions,coverage,inputHash,inputFiles,inventoryHash,
    provenance:{inputFiles,stationInventories,inputHash,inventoryHash,verifiedGnssCalls:verifiedGnss,rawRadioEvidenceCalls:rawRadioCalls,normalization:'lib/analyst/data.ts:normalizeDay:MDT',matching:'original-matchStatus-and-matchDeltaSec'},
    publicationReference:null};
  const published=path.join(publicDir,'improvement-candidates','2026-10-26_2026-10-30.json');
  if(fs.existsSync(published)){
    const reference=JSON.parse(fs.readFileSync(published,'utf8'));
    if(reference.sourceRevision===revision)document.publicationReference={sourceRevision:revision,file:'improvement-candidates/2026-10-26_2026-10-30.json',sha256:digest(fs.readFileSync(published)),status:'historical-fixed-scope-only',dateStart:'2026-10-26',dateEnd:'2026-10-30',spatialCandidates:(reference.candidates||[]).filter(c=>c.kind==='spatial').length,cellReferenceCandidates:(reference.candidates||[]).filter(c=>c.kind==='cell').map(c=>({id:c.id,label:c.label,location:c.location}))};
  }
  fs.mkdirSync(outDir,{recursive:true});fs.writeFileSync(path.join(outDir,'input.json'),JSON.stringify(document));
  return document;
}
if(require.main===module){
  const {values}=parseArgs({options:{'public-dir':{type:'string'},'date-start':{type:'string'},'date-end':{type:'string'},from:{type:'string'},to:{type:'string'},mode:{type:'string'},'out-dir':{type:'string'},help:{type:'boolean'}}});
  if(values.help){console.log('Usage: node scripts/build-voice-improvement-1-input.cjs [--public-dir DIR] [--date-start YYYY-MM-DD --date-end YYYY-MM-DD] [--from HH:MM --to HH:MM --mode holdout|screening] [--out-dir DIR]');}
  else{const d=buildInput({publicDir:values['public-dir'],dateStart:values['date-start'],dateEnd:values['date-end'],from:values.from,to:values.to,mode:values.mode,outDir:values['out-dir'],progress:true});console.log(JSON.stringify({sourceRevision:d.sourceRevision,scopeKey:d.scopeKey,coverage:d.coverage,output:'input.json'}));}
}
module.exports={buildInput,mdtLinkStatus,safeOutput};

/* SQLite queries run only in the query worker, never on the HTTP event loop. */
/* eslint-disable @typescript-eslint/no-require-imports -- Node SQLite workers load CommonJS modules. */
const {DatabaseSync}=require('node:sqlite');
const path=require('node:path');
const {load}=require('./analyst-ts-loader.cjs');
const parse=JSON.parse;
const placeholders=values=>values.map(()=>'?').join(',');
const plain=row=>row?{...row}:row;
const fail=message=>{const error=new Error(message);error.status=400;throw error;};
// oxlint-disable-next-line no-control-regex -- Query identifiers must reject ASCII control characters.
const text=(value,name,max=500)=>{if(typeof value!=='string'||value.length>max||/[\x00-\x1f]/.test(value))fail('Invalid '+name);return value;};
const ids=(value,name='customerIds',max=1000)=>{if(value==null)return null;if(!Array.isArray(value)||value.length>max)fail('Invalid '+name);return [...new Set(value.map(v=>text(v,name)).filter(v=>v.trim()))];};
const pageOf=(value,pages)=>Math.max(0,Math.min(value??0,Math.max(0,pages-1)));
function createQueryEngine({dbPath,root=path.resolve(__dirname,'..'),publicDir=path.join(root,'public')}){
  const db=new DatabaseSync(dbPath,{readOnly:true});
  db.exec('PRAGMA query_only=OFF; PRAGMA cache_size=-32768; PRAGMA temp_store=MEMORY; PRAGMA trusted_schema=OFF');
  const all=(sql,args=[])=>db.prepare(sql).all(...args).map(plain);
  const one=(sql,args=[])=>plain(db.prepare(sql).get(...args));
  const meta=parse(one("SELECT json FROM meta WHERE key='dataset'").json);
  const audit=parse(one("SELECT json FROM meta WHERE key='audit'").json);
  const overviewMeta=parse(one("SELECT json FROM meta WHERE key='overview'").json);
  if(parse(one("SELECT json FROM meta WHERE key='schema'").json)!=='voice-query-db-v1')throw Error('Unsupported voice query database schema');
  const revision=meta.revision,dates=[...meta.dates].sort((a,b)=>a<b?-1:a>b?1:0);
  const readCallObservations=require('./voice-query-export-details.cjs').createExportDetailReader({
    publicDir,exactWindow:true,includeObservedPot:true,
    entryFor:(id,date)=>{const row=one('SELECT json FROM days WHERE customer_id=? AND date=?',[id,date]);return row?parse(row.json):null;},
  });
  const areaRows=all('SELECT * FROM areas');
  const areas=Object.fromEntries(areaRows.map(a=>[a.id,[a.label,a.lat,a.lon]]));
  const boundaries=areaRows.map(a=>parse(a.json));
  const thresholds={poor:3,good:3.5,concentratedRate:.5,concentratedCount:10,minEvaluatedForRate:5,repeatDays:2,dropCount:3,dropRate:.1};
  const rounded=value=>value==null?null:Math.round(value*1e6)/1e6;
  const screeningAreas=Object.fromEntries(Object.entries(areas).map(([id,[label,lat,lon]])=>[id,[label,rounded(lat),rounded(lon)]]));
  const sourceMeta={schemaVersion:'customer-screening-v1',sourceRevision:revision,source:'MDT · SIP CDR / RTCP MOS(v5) / BYE 근거',dates,thresholds,areas:screeningAreas,customers:[],audit:{calls:audit.calls,poor:audit.poor,drops:audit.drops,customers:audit.customers}};
  let qualityKey=null;
  function scopeOf(raw={}){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('Invalid scope');
    const s={dateStart:dates[0],dateEnd:dates.at(-1),from:'00:00',to:'23:59',evidence:'all',distributionMode:'mos',sipFilter:'all',...raw};
    for(const field of ['dateStart','dateEnd'])if(!dates.includes(s[field]))fail('Invalid '+field);
    if(s.dateStart>s.dateEnd)fail('Invalid date range');
    const selected=dates.filter(d=>d>=s.dateStart&&d<=s.dateEnd);
    if(selected.some((d,i)=>i&&Date.parse(d)-Date.parse(selected[i-1])!==86400000))fail('Invalid noncontiguous date range');
    for(const field of ['from','to'])if(typeof s[field]!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s[field]))fail('Invalid '+field);
    s.min=Number(s.from.slice(0,2))*3600+Number(s.from.slice(3))*60;s.max=Number(s.to.slice(0,2))*3600+Number(s.to.slice(3))*60+60;
    if(s.min>=s.max)fail('Invalid time range');
    if(s.hour!=null&&(!Number.isInteger(s.hour)||s.hour<0||s.hour>23))fail('Invalid hour');
    for(const [key,choices] of Object.entries({evidence:['all','gnss','estimated','bye-cell'],distributionMode:['mos','drop'],sipFilter:['all','normal','drop','other'],band:[null,'poor','fair','good'],cohort:[null,'affected','repeat','consecutive']}))if(s[key]!=null&&!choices.includes(s[key]))fail('Invalid '+key);
    s.customerIds=ids(s.customerIds);if(s.district!=null)text(s.district,'district');if(s.search!=null)text(s.search,'search',200);
    return s;
  }
  function base(s,alias='c',customer=true){
    const where=[`${alias}.date>=?`,`${alias}.date<=?`,`${alias}.start_second>=?`,`${alias}.start_second<?`],args=[s.dateStart,s.dateEnd,s.min,s.max];
    if(customer&&s.customerIds?.length){where.push(`${alias}.customer_id IN (${placeholders(s.customerIds)})`);args.push(...s.customerIds);}
    return {where,args};
  }
  const link=(call,date)=>'/?'+new URLSearchParams({source:'MDT',view:'contract',date,customer:call.customerId,call:call.rawCallId??call.id.slice(call.customerId.length+1)});
  const callRecord=row=>({...parse(row.json),qoe:row.qoe});
  const {classifyConsecutiveBlocks}=load(path.resolve(__dirname,'../lib/analyst/consecutive-poor.ts'));
  const experienceCache=new Map(),gradeCache=new Map();
  const remember=(cache,key,value,limit)=>{cache.delete(key);cache.set(key,value);while(cache.size>limit)cache.delete(cache.keys().next().value);return value;};
  function experience(s){
    const b=base(s),where=b.where.join(' AND '),key=JSON.stringify(b);
    if(experienceCache.has(key))return remember(experienceCache,key,experienceCache.get(key),4);
    const poor=all(`SELECT customer_id,COUNT(*) AS poor FROM facts c INDEXED BY facts_score WHERE ${where} AND qoe<3 GROUP BY customer_id`,b.args);
    const repeat=poor.filter(r=>r.poor>=2).map(r=>r.customer_id);
    const total=one(`SELECT COUNT(DISTINCT customer_id) AS n FROM facts c NOT INDEXED WHERE ${where}`,b.args).n;
    const blocks=repeat.length?all(`SELECT customer_id,timestamp_ms,analytics_hour,COUNT(*) AS total,SUM(CASE WHEN qoe<3 THEN 1 ELSE 0 END) AS poor
      FROM facts c WHERE ${where} AND customer_id IN (${placeholders(repeat)}) GROUP BY customer_id,timestamp_ms,analytics_hour`,[...b.args,...repeat]):[];
    const customers=new Map(),hourCustomers=Array.from({length:24},()=>new Map());
    for(const row of blocks){
      const block={timestamp:row.timestamp_ms,total:row.total,poor:row.poor};
      const customer=customers.get(row.customer_id)??[];customer.push(block);customers.set(row.customer_id,customer);
      if(Number.isInteger(row.analytics_hour)&&row.analytics_hour>=0&&row.analytics_hour<24){
        const map=hourCustomers[row.analytics_hour],list=map.get(row.customer_id)??[];list.push(block);map.set(row.customer_id,list);
      }
    }
    let consecutive=[];
    for(const [id,rows] of customers){const status=classifyConsecutiveBlocks(rows);if(status===null)consecutive=null;else if(status)consecutive?.push(id);}
    const unknownPoor=one(`SELECT COUNT(*) AS n FROM facts c INDEXED BY facts_score WHERE ${where} AND qoe<3 AND timestamp_ms IS NULL`,b.args).n>0;
    const hourlyPoor=all(`SELECT analytics_hour AS hour,customer_id,COUNT(*) AS poor FROM facts c INDEXED BY facts_score WHERE ${where} AND qoe<3 AND analytics_hour IS NOT NULL GROUP BY analytics_hour,customer_id`,b.args);
    const groups={affected:poor.map(r=>r.customer_id),repeat,consecutive};
    const consecutiveHours=hourCustomers.map(map=>{let count=0;for(const rows of map.values()){const status=classifyConsecutiveBlocks(rows);if(status===null)return null;if(status)count++;}return count;});
    const hours={};
    for(const kind of ['affected','repeat'])hours[kind]=unknownPoor?null:Array.from({length:24},(_,h)=>hourlyPoor.filter(r=>r.hour===h&&(kind==='affected'||r.poor>=2)).length);
    hours.consecutive=unknownPoor||consecutive===null||consecutiveHours.some(v=>v===null)?null:consecutiveHours;
    return remember(experienceCache,key,{groups,hours,total},4);
  }
  function grades(s,drop=false){
    const b=base(s);if(drop)b.where.push('c.is_drop=1');
    const key=JSON.stringify(b);if(gradeCache.has(key))return remember(gradeCache,key,gradeCache.get(key),8);
    const grouped=all(`SELECT hour,COUNT(*) AS total,COUNT(qoe) AS evaluated,SUM(qoe) AS sum,
      SUM(CASE WHEN qoe<3 THEN 1 ELSE 0 END) AS poor,SUM(CASE WHEN qoe>=3 AND qoe<3.5 THEN 1 ELSE 0 END) AS fair,
      SUM(CASE WHEN qoe>=3.5 THEN 1 ELSE 0 END) AS good FROM facts c NOT INDEXED WHERE ${b.where.join(' AND ')} GROUP BY hour`,b.args);
    const hours=Array.from({length:24},(_,hour)=>({hour,poor:0,fair:0,good:0,unavailable:0,evaluated:0,total:0}));
    let sum=0,evaluated=0,unavailable=0;for(const r of grouped){if(!hours[r.hour])continue;Object.assign(hours[r.hour],{poor:r.poor,fair:r.fair,good:r.good,unavailable:r.total-r.evaluated,evaluated:r.evaluated,total:r.total});sum+=r.sum??0;evaluated+=r.evaluated;unavailable+=r.total-r.evaluated;}
    const counts=Object.fromEntries(['poor','fair','good'].map(k=>[k,hours.reduce((n,h)=>n+h[k],0)]));
    const bands=[['poor','불량','QoE < 3.0','#e35d64'],['fair','보통','3.0 ≤ QoE < 3.5','#efa93b'],['good','양호','QoE ≥ 3.5','#279d78']].map(([id,label,range,color])=>({id,label,range,color,count:counts[id],percentage:evaluated?100*counts[id]/evaluated:0}));
    return remember(gradeCache,key,{stats:{evaluated,unavailable,mean:evaluated?sum/evaluated:null,bands,hours},means:new Map(grouped.map(r=>[r.hour,r.evaluated?r.sum/r.evaluated:null]))},8);
  }
  function filtered(s,{allCalls=false,callId,callIds,investigation,viewLocations=false}={}){
    const b=base(s);if(s.hour!=null){b.where.push('c.hour=?');b.args.push(s.hour);}
    if(s.cohort){const group=experience(s).groups[s.cohort]??[];if(!group.length)b.where.push('0');else {b.where.push(`c.customer_id IN (${placeholders(group)})`);b.args.push(...group);}}
    if(s.distributionMode==='drop')b.where.push('c.is_drop=1');
    if(s.sipFilter!=='all'){b.where.push('c.sip_group=?');b.args.push(s.sipFilter);}
    if(callId!=null){text(callId,'callId');b.where.push('(c.id=? OR c.raw_id=?)');b.args.push(callId,callId);}
    let requested=callIds;
    if(investigation!=null){if(typeof investigation!=='object'||!['members','customers'].includes(investigation.mode))fail('Invalid investigation');if(investigation.mode==='members'){requested=ids(investigation.callIds,'investigation.callIds',10000);if(!requested)fail('Invalid investigation.callIds');}else {const customers=ids(investigation.customerIds,'investigation.customerIds',10000);if(!customers)fail('Invalid investigation.customerIds');b.where.push(customers.length?`c.customer_id IN (${placeholders(customers)})`:'0');b.args.push(...customers);}}
    if(requested!=null){requested=ids(requested,'callIds',10000).map(id=>id.replace(/^\d{4}-\d{2}-\d{2}:/,''));b.where.push(requested.length?`c.id IN (${placeholders(requested)})`:'0');b.args.push(...requested);}
    const bypass=allCalls||investigation!=null||callIds!=null;
    if(!bypass){const band=s.band??'poor';b.where.push(band==='poor'?'c.qoe>=-1.5 AND c.qoe<3':band==='fair'?'c.qoe>=3 AND c.qoe<3.5':'c.qoe>=3.5 AND c.qoe<=5');}
    const kind=allCalls&&!viewLocations?'original':s.evidence==='bye-cell'?'original':'view';
    if(!bypass&&(!s.band||s.district||s.evidence!=='all')||bypass&&(s.district||s.evidence!=='all')){
      const w=['l.call_id=c.id','l.kind=?'],args=[kind];if(s.district){w.push('l.area=?');args.push(s.district);}if(s.evidence!=='all'){w.push('l.evidence=?');args.push(s.evidence);}b.where.push(`EXISTS (SELECT 1 FROM locations l WHERE ${w.join(' AND ')})`);b.args.push(...args);
    }
    if(s.search?.trim()){b.where.push(`lower('고객 ··'||upper(substr(c.customer_id,-5))||' '||c.date||' '||json_extract(c.json,'$.start')||' '||COALESCE((SELECT a.label FROM locations sl JOIN areas a ON a.id=sl.area WHERE sl.call_id=c.id AND sl.kind=?),'')) LIKE ? ESCAPE '\\'`);b.args.push(kind,'%'+s.search.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')+'%');}
    return {...b,kind};
  }
  function summary(s){
    const gradeResult=grades(s),g=gradeResult.stats,dropGrades=grades(s,true).stats,exp=experience(s),b=base(s);
    const bins=Array.from({length:20},(_,i)=>{const from=i/4,to=(i+1)/4,band=(from+to)/2<3?'poor':(from+to)/2<3.5?'fair':'good';return {from,to,count:0,color:{poor:'#e46161',fair:'#f1bc32',good:'#43b581'}[band],band};});
    for(const r of all(`SELECT min(19,CAST(qoe*4 AS INTEGER)) AS bin,COUNT(*) AS n FROM facts c NOT INDEXED WHERE ${b.where.join(' AND ')} AND qoe>=0 AND qoe<=5 GROUP BY bin`,b.args))bins[r.bin].count=r.n;
    const meanByHour=gradeResult.means;
    const analytics={metric:'qoe',threshold:3,total:g.evaluated+g.unavailable,evaluated:g.evaluated,unscored:g.unavailable,average:g.mean,outOfRange:one(`SELECT COUNT(*) AS n FROM facts c NOT INDEXED WHERE ${b.where.join(' AND ')} AND (qoe<0 OR qoe>5)`,b.args).n,
      bands:['good','fair','poor'].map(id=>{const count=g.bands.find(v=>v.id===id).count;return {id,label:{good:'양호',fair:'보통',poor:'불량'}[id],count,percent:g.evaluated?count/g.evaluated*100:null,color:{poor:'#e46161',fair:'#f1bc32',good:'#43b581'}[id]};}),bins,
      experience:['affected','repeat','consecutive'].map(id=>{const count=exp.groups[id]?.length??null;return {id,label:{affected:'저품질 1회 이상',repeat:'2회 이상 반복',consecutive:'2회 이상 연속'}[id],count,total:exp.total,percent:count!=null&&exp.total&&g.evaluated?count/exp.total*100:null,customerIds:[],hourly:g.evaluated&&count!=null?exp.hours[id]:null};}),termination:{count:null,rate:null,unknown:g.evaluated+g.unavailable}};
    // Region rankings intentionally remain the whole hour/cohort/evidence set;
    // district selection focuses mapped counters without removing other ranks.
    const f=filtered({...s,district:null,sipFilter:'all',search:'',band:s.band??'poor'});
    f.where.push('l.kind=?');f.args.push(f.kind);if(s.evidence!=='all'){f.where.push('l.evidence=?');f.args.push(s.evidence);}
    const regionStats=all(`SELECT l.area AS id,COUNT(*) AS poorCalls,SUM(l.evidence='gnss') AS gnssCalls,SUM(l.evidence='estimated') AS estimatedCalls,SUM(l.evidence='bye-cell') AS byeCellCalls,COUNT(DISTINCT c.customer_id) AS customerCount FROM facts c JOIN locations l ON l.call_id=c.id WHERE ${f.where.join(' AND ')} GROUP BY l.area`,f.args);
    const regions=regionStats.filter(r=>areas[r.id]).map(r=>({...r,label:areas[r.id][0],lat:areas[r.id][1],lon:areas[r.id][2]})).sort((a,b)=>b.poorCalls-a.poorCalls||a.label.localeCompare(b.label,'ko'));
    const m=filtered({...s,sipFilter:'all',search:'',band:s.band??'poor'});m.where.push("l.kind=? AND l.evidence IN ('gnss','estimated')");m.args.push(m.kind);if(s.evidence!=='all'){m.where.push('l.evidence=?');m.args.push(s.evidence);}if(s.district){m.where.push('l.area=?');m.args.push(s.district);}
    const points=all(`SELECT c.hour,l.evidence,COUNT(*) AS n FROM facts c JOIN locations l ON l.call_id=c.id WHERE ${m.where.join(' AND ')} GROUP BY c.hour,l.evidence`,m.args);
    const mapped={G:0,T:0,U:0,hourly:Array(24).fill(0)};for(const p of points){mapped[p.evidence==='gnss'?'G':'T']+=p.n;if(p.hour>=0&&p.hour<24)mapped.hourly[p.hour]+=p.n;}mapped.U=mapped.G+mapped.T;
    return {grades:g,dropGrades,hourly:g.hours.map(h=>({hour:h.hour,total:h.total,evaluated:h.evaluated,poor:h.poor,other:h.fair+h.good,mean:meanByHour.get(h.hour)??null})),analytics,customerCount:exp.total,mapped,regions};
  }
  function callPage(s,args){
    const f=filtered(s,args),count=one(`SELECT COUNT(*) AS n FROM calls c WHERE ${f.where.join(' AND ')}`,f.args).n;
    const size=args.pageSize??25;if(!Number.isInteger(size)||size<1||size>1000)fail('Invalid pageSize');if(args.page!=null&&(!Number.isInteger(args.page)||args.page<0))fail('Invalid page');const page=pageOf(args.page,Math.ceil(count/size));
    const indexHint=!args.allCalls&&!args.investigation&&!args.callIds?' INDEXED BY calls_band':'';
    const raw=all(`SELECT c.json,c.qoe FROM calls c${indexHint} WHERE ${f.where.join(' AND ')} ORDER BY COALESCE(json_extract(c.json,'$.startTimestamp'),'') DESC,c.start_second DESC,c.id LIMIT ? OFFSET ?`,[...f.args,size,page*size]);
    const rows=raw.map(callRecord),callIds=rows.map(c=>c.id);
    const locations=callIds.length?all(`SELECT json FROM locations WHERE kind=? AND call_id IN (${placeholders(callIds)})`,[f.kind,...callIds]).map(r=>parse(r.json)):[];
    const roughLocations=args.allCalls&&callIds.length?all(`SELECT json FROM locations WHERE kind='view' AND evidence='estimated' AND call_id IN (${placeholders(callIds)})`,callIds).map(r=>parse(r.json)):[];
    return {rows,locations,total:count,page,pageSize:size,...(roughLocations.length?{roughLocations}: {})};
  }
  function map(s,args={}){
    const f=filtered({...s,band:s.band??'poor',sipFilter:'all',search:''},args.allGrades?{allCalls:true,viewLocations:true}:{});f.where.push("l.kind=? AND l.evidence IN ('gnss','estimated')");f.args.push(f.kind);if(s.evidence!=='all'){f.where.push('l.evidence=?');f.args.push(s.evidence);}if(s.district){f.where.push('l.area=?');f.args.push(s.district);}
    // Start from renderable locations. A date-indexed calls-first plan reads
    // 1.49M bulky records to find only ~2K points in an all-grade candidate map.
    const rows=all(`SELECT c.json,c.qoe,l.json AS location FROM locations l CROSS JOIN calls c ON c.id=l.call_id WHERE ${f.where.join(' AND ')}`,f.args);
    const calls=rows.map(callRecord),richLocations=rows.map(r=>parse(r.location));
    const stationHelper=load(path.resolve(__dirname,'../lib/analyst/quality-map-stations.ts'));
    const stationCount=stationHelper.countStationMapPositions(stationHelper.relatedStationMarkersForMap(richLocations));
    const locations=args.includeStations===false?richLocations.map(point=>{
      const light={...point};for(const field of ['gpsStation','usedStations','byeStationLat','byeStationLon'])delete light[field];return light;
    }):richLocations;
    const byArea=new Map();for(const p of locations){const group=byArea.get(p.areaId)??[];group.push(p);byArea.set(p.areaId,group);}
    return {stationCount,overview:{...overviewMeta,date:s.dateStart===s.dateEnd?s.dateStart:s.dateStart+' ~ '+s.dateEnd,calls,callLocations:locations,cells:[...byArea].map(([id,list])=>({id,label:areas[id]?.[0]??id,lat:areas[id]?.[1]??list[0].lat,lon:areas[id]?.[2]??list[0].lon,callIds:list.map(p=>p.callId),gnssCalls:list.filter(p=>p.evidence==='gnss').length,estimatedCalls:list.filter(p=>p.evidence==='estimated').length,byeCellCalls:0})),administrativeDongs:boundaries.filter(d=>byArea.has(d.id))}};
  }
  function mapStations(s,args){
    const rich=map(s,{...args,includeStations:true});
    const helper=load(path.resolve(__dirname,'../lib/analyst/quality-map-stations.ts'));
    const fields=['gpsStation','usedStations','byeStationLat','byeStationLon'];
    return {stationCount:rich.stationCount,stations:helper.relatedStationMarkersForMap(rich.overview.callLocations),
      locations:rich.overview.callLocations.map(point=>({callId:point.callId,...Object.fromEntries(fields.filter(field=>Object.hasOwn(point,field)).map(field=>[field,point[field]]))}))};
  }
  function qualityRows(s,customerIds){
    const b=base(s,'c',false);if(customerIds){b.where.push(customerIds.length?`c.customer_id IN (${placeholders(customerIds)})`:'0');b.args.push(...customerIds);}
    return all(`SELECT c.customer_id AS customerId,COUNT(*) AS totalCalls,SUM(CASE WHEN c.mos>=1 AND c.mos<3 THEN 1 ELSE 0 END) AS poorCalls,
      SUM(c.located) AS locatedCalls FROM facts c WHERE ${b.where.join(' AND ')} GROUP BY c.customer_id`,b.args);
  }
  function enrichQuality(row,s){
    const b=base(s,'c',false);b.where.push('c.customer_id=?');b.args.push(row.customerId);
    const latest=one(`SELECT c.json,c.qoe,c.date FROM calls c WHERE ${b.where.join(' AND ')} ORDER BY date DESC,source_clock DESC,id LIMIT 1`,b.args);
    const customer=one('SELECT number FROM customers WHERE id=?',[row.customerId]);
    const contractIds=[...new Set([customer?.number,...all(`SELECT c.contract FROM calls c WHERE ${b.where.join(' AND ')} AND c.contract IS NOT NULL ORDER BY date DESC,source_clock DESC,id`,b.args).map(r=>r.contract),...all('SELECT contract FROM days WHERE customer_id=? AND date>=? AND date<=? ORDER BY date DESC',[row.customerId,s.dateStart,s.dateEnd]).map(r=>r.contract)].filter(v=>typeof v==='string'&&v.trim()))];
    const latestCall=callRecord(latest),sourceContractId=customer?.number?.trim()?customer.number:contractIds[0]??null;
    return {...row,sourceContractId,contractIds,unlocatedCalls:row.totalCalls-row.locatedCalls,latestCall,latestDate:latest.date,href:link(latestCall,latest.date)};
  }
  function customers(s,args){
    const filter=args.filter??'all';if(!['all','poor','repeat'].includes(filter))fail('Invalid customer filter');const query=text(args.query??'','query',200).trim().toLowerCase();
    const selected=ids(args.selectedIds)??[];
    const b=base(s,'c',false),key=JSON.stringify(b);
    if(qualityKey!==key){db.exec('DROP TABLE IF EXISTS temp.quality_rows');db.prepare(`CREATE TEMP TABLE quality_rows AS SELECT c.customer_id AS customerId,COUNT(*) AS totalCalls,SUM(CASE WHEN c.mos>=1 AND c.mos<3 THEN 1 ELSE 0 END) AS poorCalls,SUM(c.located) AS locatedCalls FROM facts c NOT INDEXED WHERE ${b.where.join(' AND ')} GROUP BY c.customer_id`).run(...b.args);db.exec('CREATE INDEX temp.quality_rows_rank ON quality_rows(poorCalls DESC,customerId)');qualityKey=key;}
    const where=[],params=[];if(args.selectedOnly){where.push(selected.length?`r.customerId IN (${placeholders(selected)})`:'0');params.push(...selected);}if(filter!=='all')where.push('poorCalls>='+(filter==='repeat'?2:1));
    if(query){where.push(`r.customerId IN (SELECT id FROM customers WHERE lower(number) LIKE ? ESCAPE '\\' UNION SELECT customer_id FROM facts ca WHERE ca.date>=? AND ca.date<=? AND ca.start_second>=? AND ca.start_second<? AND lower(ca.contract) LIKE ? ESCAPE '\\' UNION SELECT customer_id FROM days WHERE date>=? AND date<=? AND lower(contract) LIKE ? ESCAPE '\\')`);const needle='%'+query.replace(/[\\%_]/g,'\\$&')+'%';params.push(needle,s.dateStart,s.dateEnd,s.min,s.max,needle,s.dateStart,s.dateEnd,needle);}
    const cte='WITH r AS (SELECT * FROM quality_rows) ';
    const tail=where.length?' WHERE '+where.map(w=>'('+w+')').join(' AND '):'';
    const total=one(cte+'SELECT COUNT(*) AS n FROM r'+tail,params).n,pages=Math.ceil(total/25),page=pageOf(args.page,pages);
    const rows=all(cte+'SELECT * FROM r'+tail+' ORDER BY poorCalls DESC,customerId LIMIT 25 OFFSET ?',[...params,page*25]).map(row=>enrichQuality(row,s));
    let selection;
    if(args.selectedIds){const selectedRows=qualityRows(s,selected);selection={customerIds:selected,count:selected.length,withoutCalls:selected.length-selectedRows.length,totalCalls:selectedRows.reduce((n,r)=>n+r.totalCalls,0),poorCalls:selectedRows.reduce((n,r)=>n+r.poorCalls,0),locatedCalls:selectedRows.reduce((n,r)=>n+r.locatedCalls,0),unlocatedCalls:selectedRows.reduce((n,r)=>n+r.totalCalls-r.locatedCalls,0),single:selected.length===1&&selectedRows.length?enrichQuality(selectedRows[0],s):null};}
    return {rows,total,page,pages,...(selection?{selection}:{})};
  }
  function customer(args){
    let row;if(args.customerId!=null){text(args.customerId,'customerId');row=one('SELECT id,json FROM customers WHERE id=?',[args.customerId]);}
    else if(args.contract!=null){text(args.contract,'contract');row=one('SELECT id,json FROM customers WHERE number=? ORDER BY id LIMIT 1',[args.contract])??one('SELECT c.id,c.json FROM customers c JOIN days d ON d.customer_id=c.id WHERE d.contract=? ORDER BY d.date DESC,c.id LIMIT 1',[args.contract]);}
    else row=one('SELECT id,json FROM customers ORDER BY id LIMIT 1');
    return {dataset:{meta,customers:row?[parse(row.json)]:[],days:row?all('SELECT json FROM days WHERE customer_id=? ORDER BY date',[row.id]).map(r=>parse(r.json)):[]}};
  }
  const {createScreeningQueries}=require('./voice-query-screening.cjs');
  const deviceReader=require('./customer-device-reader.cjs').createCustomerDeviceReader({root,publicDir,sourceRevision:revision});
  const {screening,source:screeningSource,map:screeningMap,customerQoeTimeline}=createScreeningQueries({db,all,one,base,dates,areas,sourceMeta,rounded,text,pageOf,deviceModelsFor:(id,scope)=>deviceReader.modelsFor(id,scope)});
  function query(args){
    if(!args||typeof args!=='object'||Array.isArray(args))fail('Invalid query');if(args.sourceRevision!=null&&args.sourceRevision!==revision){const e=new Error('Source revision mismatch; reload the dataset.');e.status=409;throw e;}
    if(args.page!=null&&(!Number.isInteger(args.page)||args.page<0))fail('Invalid page');
    for(const k of ['allCalls','allGrades','selectedOnly','includeStations'])if(args[k]!=null&&typeof args[k]!=='boolean')fail('Invalid '+k);
    let result;const op=args.op;
    if(op==='meta'){const {baseStations:_baseStations,callMeta:_callMeta,...lightMeta}=meta;result={schemaVersion:'voice-query-meta-v1',dataset:{meta:lightMeta,customers:[],days:[]},regionNames:Object.fromEntries(Object.entries(areas).map(([id,area])=>[id,area[0]])),totalCalls:audit.calls,totalCustomers:audit.customers};}
    else if(op==='customer')result=customer(args);
    else if(op==='call-observations'){
      if(args.sourceRevision!==revision || !dates.includes(args.callDate))fail('Original call date and revision required');
      const callId=text(args.callId,'callId');
      const row=one('SELECT customer_id,raw_id FROM calls WHERE id=? AND date=?',[callId,args.callDate]);
      if(!row)fail('Original call not found for this date');
      const detail=readCallObservations(row.customer_id,args.callDate,row.raw_id);
      result={callId,callDate:args.callDate,samples:(detail?.radioSeries??[]).filter(s=>s.timestamp).map(s=>({
        timestamp:s.timestamp,pot:s.pot??null,earfcn:s.frequency,technology:s.radioTechnology,
      }))};
    }
    else {const s=scopeOf(args.scope);if(op==='summary')result=summary(s);else if(op==='calls')result=callPage(s,args);else if(op==='map')result=map(s,args);else if(op==='map-stations')result=mapStations(s,args);else if(op==='customers')result=customers(s,args);else if(op==='screening')result=screening(s,args);else if(op==='screening-map'){
      result=screeningMap(s,args);
    }else if(op==='customer-qoe-timeline'){
      result=customerQoeTimeline(s,args);
    }else if(op==='routes'){
      const customerIds=ids(args.customerIds,'customerIds',10)??[];if(args.day!=null&&args.day!=='all'&&!dates.includes(args.day))fail('Invalid route day');const source=screeningSource(s,{customerIds}),helper=load(path.resolve(__dirname,'../lib/analyst/customer-screening-route.ts'));
      result={routes:customerIds.map(id=>helper.buildCustomerRoute(source,id,s.dateStart,s.dateEnd,s.from,s.to,args.day??'all')).filter(Boolean)};
    }else fail('Unsupported voice query operation');}
    return {sourceRevision:revision,...result};
  }
  function* exportCsv(args){
    if(args.sourceRevision!==revision){const e=new Error('Source revision mismatch; reload before export.');e.status=409;throw e;}
    const s=scopeOf(args.scope),f=filtered(s,args);
    const quote=value=>{let v=value==null?'':String(value);if(/^\s*[=+@-]/.test(v)&&typeof value!=='number')v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
    const head=['시작','종료','고객 익명 표시ID','행정동','QoE(Drop 반영)','원본 MOS(v5)','SIP 구분 (11.REASON)','원본 SIP 11.REASON','RTP Loss 원본','Jitter 원본','RSRP dBm','SINR dB','위도','경도','위치 근거','대표 관측 UTC','CDR 종료 UTC','종료 전 시간차(초)','BYE Cell ID','BYE RU ID','좌표 선정 방식','BYE RU 선택 근거','BYE 후보 수','BYE 선택 MDT 종료 전 시간차(초)','sourceRevision','callId','rawCallId','customerId','serviceNumber','RTP Rx Loss 원본','Rx Jitter 원본'];
    yield '\ufeff'+head.map(quote).join(',')+'\r\n';
    const readDetail=require('./voice-query-export-details.cjs').createExportDetailReader({publicDir,entryFor:(id,date)=>{const row=one('SELECT json FROM days WHERE customer_id=? AND date=?',[id,date]);return row?parse(row.json):null;}});
    const hint=!args.allCalls&&!args.investigation&&!args.callIds?' INDEXED BY calls_band':'';
    const stmt=db.prepare(`SELECT c.*,p.number,l.json AS location FROM calls c${hint} LEFT JOIN customers p ON p.id=c.customer_id LEFT JOIN locations l ON l.call_id=c.id AND l.kind=? WHERE ${f.where.join(' AND ')} ORDER BY COALESCE(json_extract(c.json,'$.startTimestamp'),'') DESC,c.start_second DESC,c.id`);
    let chunk='';for(const r of stmt.iterate(f.kind,...f.args)){const c=parse(r.json),p=r.location?parse(r.location):{},detail=readDetail(r.customer_id,r.date,r.raw_id);chunk+=[r.date+' '+c.start,c.end,'고객 ··'+r.customer_id.slice(-5).toUpperCase(),areas[p.areaId]?.[0]??'',r.qoe,r.mos,{drop:'Drop',normal:'Normal',other:'기타'}[r.sip_group],c.sipCause,detail?.rtp?.txPacketLoss,detail?.rtp?.txJitter,detail?.rsrp,detail?.sinr,p.lat,p.lon,p.evidence,p.observedAt,p.cdrEndAt,p.secondsBeforeEnd,p.byeCellId,p.byeRuId,p.representativeBasis,p.byeSelectionMethod,p.byeCandidateCount,p.byeSelectionDeltaSeconds,revision,r.id,r.raw_id,r.customer_id,r.number,detail?.rtp?.rxPacketLoss,detail?.rtp?.rxJitter].map(quote).join(',')+'\r\n';if(chunk.length>=65536){yield chunk;chunk='';}}if(chunk)yield chunk;
  }
  return {query,exportCsv,screeningSource:raw=>screeningSource(scopeOf(raw)),close:()=>{deviceReader.close();db.close();}};
}
module.exports={createQueryEngine};

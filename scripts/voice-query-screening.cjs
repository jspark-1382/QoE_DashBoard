/* Scope-bound screening read model. Original source data stays immutable. */
/* eslint-disable @typescript-eslint/no-require-imports -- Node SQLite worker module. */
const path=require('node:path');
const {load}=require('./analyst-ts-loader.cjs');
const placeholders=values=>values.map(()=>'?').join(',');
const fail=message=>{const error=new Error(message);error.status=400;throw error;};
function createScreeningQueries({db,all,one,base,dates,areas,sourceMeta,rounded,text,pageOf}){
  let screeningKey=null,scopeSequence=0,cellSites=null;
  const scopeCache=new Map(),enrichmentCache=new Map(),geographyCache=new Map();
  const MAX_SCOPES=2,MAX_ENRICHMENTS=512,MAX_GEOGRAPHIES=2;
  const hasDefaultRows=!!one("SELECT name FROM sqlite_master WHERE type='table' AND name='screen_default_rows'");
  const defaultReportRow=hasDefaultRows?one("SELECT json FROM meta WHERE key='screening-default-report'"):null;
  const defaultReport=defaultReportRow?JSON.parse(defaultReportRow.json):null;
  function remember(cache,key,value,limit){cache.delete(key);cache.set(key,value);while(cache.size>limit)cache.delete(cache.keys().next().value);return value;}
  function activateScope(entry,key){
    if(screeningKey===key)return;
    db.exec('DROP VIEW IF EXISTS temp.screen_rows');
    db.exec('CREATE TEMP VIEW screen_rows AS SELECT * FROM '+entry.table);
    screeningKey=key;
  }
  function ensureScreening(s,areaId,cellId){
    const b=base(s);if(areaId){b.where.push('c.screen_area=?');b.args.push(text(areaId,'areaId'));}if(cellId){b.where.push('c.cell=?');b.args.push(text(cellId,'cellId'));}
    const key=JSON.stringify([b.where,b.args]);
    const cached=scopeCache.get(key);
    if(cached){scopeCache.delete(key);scopeCache.set(key,cached);activateScope(cached,key);return;}
    if(hasDefaultRows&&!areaId&&!cellId&&!s.customerIds?.length&&s.dateStart===dates[0]&&s.dateEnd===dates.at(-1)&&s.min===0&&s.max===86400){
      const entry={table:'main.screen_default_rows',persistent:true,report:defaultReport};
      scopeCache.set(key,entry);activateScope(entry,key);evictScopes();return;
    }
    const table='screen_scope_'+(++scopeSequence);
    db.prepare(`CREATE TEMP TABLE ${table} AS WITH selected AS (
      SELECT c.customer_id,c.date,ROUND(c.qoe,6) AS qoe,c.is_drop,c.screen_area FROM facts c NOT INDEXED WHERE ${b.where.join(' AND ')}),
      grouped AS (SELECT customer_id AS id,COUNT(*) AS total,COUNT(qoe) AS eligible,SUM(CASE WHEN qoe<3 THEN 1 ELSE 0 END) AS poor,
        SUM(is_drop) AS dropCount,AVG(qoe) AS mean,COUNT(DISTINCT CASE WHEN qoe<3 THEN date END) AS repeatedDays FROM selected GROUP BY customer_id),
      area_days AS (SELECT customer_id,screen_area,COUNT(DISTINCT date) AS n FROM selected WHERE qoe<3 AND screen_area<>'' GROUP BY customer_id,screen_area),
      highest AS (SELECT customer_id,MAX(n) AS sameAreaDays FROM area_days GROUP BY customer_id),
      rates AS (SELECT g.*,COALESCE(p.number,'') AS number,CASE WHEN eligible>0 THEN poor*1.0/eligible ELSE 0 END AS poorRate,dropCount*1.0/total AS dropRate,COALESCE(h.sameAreaDays,0) AS sameAreaDays FROM grouped g LEFT JOIN customers p ON p.id=g.id LEFT JOIN highest h ON h.customer_id=g.id)
      SELECT *,CASE WHEN poor>=10 OR (eligible>=5 AND poor>0 AND poorRate>=.5) THEN 1 ELSE 0 END AS concentrated,
        CASE WHEN dropCount>=3 OR (total>=5 AND dropCount>0 AND dropRate>=.1) THEN 1 ELSE 0 END AS dropHeavy FROM rates`).run(...b.args);
    db.exec('CREATE INDEX temp.'+table+'_id ON '+table+'(id)');
    const entry={table};scopeCache.set(key,entry);activateScope(entry,key);
    evictScopes();
  }
  function evictScopes(){
    while(scopeCache.size>MAX_SCOPES){const first=scopeCache.keys().next().value;const old=scopeCache.get(first);scopeCache.delete(first);if(!old.persistent)db.exec('DROP TABLE temp.'+old.table);}
  }
  const groupSql="CASE WHEN concentrated THEN 'concentrated' WHEN repeatedDays>=2 THEN 'repeat' WHEN dropHeavy THEN 'drop' WHEN poor>0 THEN 'temporary' ELSE 'good' END";
  function enrichScreen(row,s,includeBad=false,areaId,cellId){
    const cacheKey=JSON.stringify([base(s),areaId??'',cellId??'',row.id]);
    const previous=enrichmentCache.get(cacheKey);
    if(previous){remember(enrichmentCache,cacheKey,previous,MAX_ENRICHMENTS);return includeBad?previous:{...previous,badCalls:[]};}
    const b=base(s);b.where.push('c.customer_id=? AND ROUND(c.qoe,6)<3');b.args.push(row.id);if(areaId){b.where.push("COALESCE(NULLIF(c.area,''),l.area,'')=?");b.args.push(areaId);}if(cellId){b.where.push('c.cell=?');b.args.push(cellId);}
    const bad=all(`SELECT c.date,c.start_second AS second,ROUND(c.qoe,6) AS qoe,c.is_drop AS dropCall,COALESCE(NULLIF(c.area,''),l.area,'') AS area,c.cell,l.lat,l.lon,COALESCE(l.evidence,'') AS evidence,c.raw_id AS rawCallId FROM calls c LEFT JOIN locations l ON l.call_id=c.id AND l.kind='original' WHERE ${b.where.join(' AND ')} ORDER BY c.date,c.rowid`,b.args);
    // Stable ties follow the original published call order, as the browser helper.
    const counts=(field)=>{const map=new Map();for(const c of bad)if(c[field])map.set(c[field],(map.get(c[field])??0)+1);return [...map].sort((a,b)=>b[1]-a[1])[0]?.[0]??'';};
    const mainAreaId=counts('area'),mainCell=counts('cell');bad.sort((a,b)=>b.date.localeCompare(a.date)||b.second-a.second);
    const dailyPoor=dates.map(date=>bad.filter(c=>c.date===date).length),latest=bad[0];
    const query=new URLSearchParams({source:'MDT',view:'contract',date:latest?.date??s.dateEnd,customer:row.id});if(latest?.rawCallId)query.set('call',latest.rawCallId);
    const full={id:row.id,number:row.number,total:row.total,eligible:row.eligible,poor:row.poor,poorRate:row.poorRate,drop:row.dropCount,dropRate:row.dropRate,mean:row.mean,repeatedDays:row.repeatedDays,sameAreaDays:row.sameAreaDays,latestDate:latest?.date??'',mainArea:areas[mainAreaId]?.[0]??(mainAreaId?'행정동 미확인':'위치 근거 없음'),mainAreaId,mainCell,group:row.concentrated?'concentrated':row.repeatedDays>=2?'repeat':row.dropHeavy?'drop':row.poor?'temporary':'good',badCalls:bad.map(c=>({date:c.date,second:c.second,qoe:c.qoe,drop:Boolean(c.dropCall),area:c.area,cell:c.cell,lat:c.lat==null?null:Math.round(c.lat*1e6)/1e6,lon:c.lon==null?null:Math.round(c.lon*1e6)/1e6,evidence:c.evidence,rawCallId:c.rawCallId})),dailyPoor,href:'/?'+query};
    remember(enrichmentCache,cacheKey,full,MAX_ENRICHMENTS);
    return includeBad?full:{...full,badCalls:[]};
  }
  function ranking(args){
    const query=text(args.query??'','query',200).trim(),filter=args.filter??'all',sort=args.sort??'poor';if(!['all','affected','repeat','concentrated','drop'].includes(filter)||!['poor','drop','repeat'].includes(sort))fail('Invalid screening filter/sort');
    const where=[],params=[];if(query){where.push("(number LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')");const needle='%'+query.replace(/[\\%_]/g,'\\$&')+'%';params.push(needle,needle);}if(filter!=='all')where.push({affected:'poor>0',repeat:'repeatedDays>=2',concentrated:'concentrated=1',drop:'dropHeavy=1'}[filter]);
    const order={poor:'poor DESC,repeatedDays DESC,poorRate DESC,dropCount DESC,number',drop:'dropCount DESC,poor DESC,dropRate DESC,repeatedDays DESC,poorRate DESC,number',repeat:'repeatedDays DESC,poor DESC,sameAreaDays DESC,poorRate DESC,dropCount DESC,number'}[sort];return {where:where.length?' WHERE '+where.join(' AND '):'',params,order};
  }
  function reportForCurrentScope(){
    const entry=scopeCache.get(screeningKey);if(entry.report)return entry.report;
    const counts=one('SELECT COUNT(*) AS total,SUM(poor>0) AS affected,SUM(repeatedDays>=2) AS repeat,SUM(concentrated) AS concentrated,SUM(dropHeavy) AS dropHeavy,SUM(sameAreaDays>=2) AS locationRepeat,SUM(total) AS calls,SUM(eligible) AS eligible,SUM(poor) AS poor,SUM(dropCount) AS "drop",SUM(CASE WHEN poor>0 THEN total ELSE 0 END) AS affectedCallTotal FROM screen_rows');
    const {affectedCallTotal,...report}=counts;for(const k of Object.keys(report))report[k]??=0;report.groups={concentrated:0,repeat:0,drop:0,temporary:0,good:0};for(const r of all(`SELECT ${groupSql} AS kind,COUNT(*) AS n FROM screen_rows GROUP BY kind`))report.groups[r.kind]=r.n;
    entry.report={report,affectedCallTotal:affectedCallTotal??0};return entry.report;
  }
  function screening(s,args,includeBad=false){
    ensureScreening(s);const {report,affectedCallTotal}=reportForCurrentScope();
    const r=ranking(args),total=one('SELECT COUNT(*) AS n FROM screen_rows'+r.where,r.params).n,pages=Math.ceil(total/25),page=pageOf(args.page,pages);
    const rows=all('SELECT * FROM screen_rows'+r.where+' ORDER BY '+r.order+' LIMIT 25 OFFSET ?',[...r.params,page*25]).map(row=>enrichScreen(row,s,includeBad));
    const topRows=all('SELECT * FROM screen_rows'+r.where+' ORDER BY '+r.order+' LIMIT 10',r.params).map(row=>enrichScreen(row,s,includeBad));
    const areaId=args.areaId,cellId=args.cellId;if(areaId||cellId)ensureScreening(s,areaId,cellId);
    const comparisonWhere=areaId||cellId?' WHERE poor>0':r.where,comparisonParams=areaId||cellId?[]:r.params;
    const comparableRaw=all('SELECT * FROM screen_rows'+comparisonWhere+' ORDER BY '+(areaId||cellId?'poor DESC,repeatedDays DESC,poorRate DESC,dropCount DESC,number':r.order)+' LIMIT 4',comparisonParams);
    let selectedRaw;if(args.selectedId!=null){text(args.selectedId,'selectedId');selectedRaw=one('SELECT * FROM screen_rows'+comparisonWhere+(comparisonWhere?' AND ':' WHERE ')+'id=?',[...comparisonParams,args.selectedId]);}selectedRaw??=comparableRaw[0];
    const selected=selectedRaw?enrichScreen(selectedRaw,s,includeBad,areaId,cellId):null;
    const comparable=(selected?[selected,...comparableRaw.filter(r=>r.id!==selected.id).slice(0,3).map(r=>enrichScreen(r,s,includeBad,areaId,cellId))]:[]);
    return {dates,source:sourceMeta,report,affectedCallTotal:affectedCallTotal??0,topRows,rows,total,page,pages,selected,comparable,selectedRegion:areaId?areas[areaId]?.[0]??areaId:cellId?'BYE Cell '+cellId:''};
  }
  function screeningSource(s,{customerIds,onlyInteresting=false}={}){
    const b=base(s);if(customerIds){b.where.push(customerIds.length?`c.customer_id IN (${placeholders(customerIds)})`:'0');b.args.push(...customerIds);}if(onlyInteresting)b.where.push('(c.qoe<3 OR c.is_drop=1)');
    const hint=customerIds?.length||s.customerIds?.length?' INDEXED BY facts_customer_date':' NOT INDEXED';
    const rows=all(`SELECT c.customer_id,c.date,c.start_second,c.qoe,c.is_drop,COALESCE(NULLIF(c.area,''),l.area,'') AS area,c.cell,l.lat,l.lon,COALESCE(l.evidence,'') AS evidence,CASE WHEN c.qoe<3 THEN c.raw_id ELSE '' END AS raw_id,c.end_second,COALESCE(p.number,'') AS number FROM facts c${hint} LEFT JOIN locations l ON l.call_id=c.id AND l.kind='original' LEFT JOIN customers p ON p.id=c.customer_id WHERE ${b.where.join(' AND ')} ORDER BY c.date,c.rowid`,b.args);
    const people=new Map();for(const r of rows){const customer=people.get(r.customer_id)??{id:r.customer_id,number:r.number,calls:[]};customer.calls.push([dates.indexOf(r.date),r.start_second,rounded(r.qoe),r.is_drop,r.area,r.cell,rounded(r.lat),rounded(r.lon),r.evidence,r.raw_id,r.end_second]);people.set(r.customer_id,customer);}
    cellSites??=Object.fromEntries(all('SELECT * FROM cell_sites').map(r=>[r.cell,[r.lat,r.lon]]));
    return {...sourceMeta,cellSites,customers:[...people.values()].sort((a,b)=>a.id.localeCompare(b.id))};
  }

  function screeningMap(s,args){
    const key=JSON.stringify(base(s));
    let cached=geographyCache.get(key);
    if(!cached){
      const source=screeningSource(s,{onlyInteresting:true});
      const mapHelper=load(path.resolve(__dirname,'../lib/analyst/customer-screening-map.ts'));
      cached={geography:mapHelper.buildScreeningGeography(source,s.dateStart,s.dateEnd,s.from,s.to),cellSites:source.cellSites};
      remember(geographyCache,key,cached,MAX_GEOGRAPHIES);
    }else remember(geographyCache,key,cached,MAX_GEOGRAPHIES);
    ensureScreening(s);
    const r=ranking(args),topRows=all('SELECT * FROM screen_rows'+r.where+' ORDER BY '+r.order+' LIMIT 10',r.params)
      .map(row=>enrichScreen(row,s,true));
    const topHelper=load(path.resolve(__dirname,'../lib/analyst/customer-screening-top-ten.ts'));
    return {geography:cached.geography,topCustomers:topHelper.buildTopCustomerMap(topRows),source:{...sourceMeta,cellSites:cached.cellSites}};
  }
  return {screening,source:screeningSource,map:screeningMap};
}
module.exports={createScreeningQueries};

/* eslint-disable @typescript-eslint/no-require-imports -- Shared local Node fixture. */
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
function createCandidateFixture(root){
 const publicDir=path.join(root,'public'),sourceRevision='fixture-candidate-revision';
 const scope={sourceRevision,dateStart:'2026-10-26',dateEnd:'2026-10-27',from:'00:00',to:'23:59',policy:'strict-3-site-v1'};
 const target={kind:'candidate',candidateId:'spatial-fixture-one',sourceRevision,scope:{dateStart:scope.dateStart,dateEnd:scope.dateEnd,from:scope.from,to:scope.to},candidateScope:{scopeKey:'fixture-full-scope',policy:scope.policy,analysisMode:'all',locationMode:'gps-mdt-rough-unvalidated-v1',modelId:'dbscan'}};
 const write=(relative,value)=>{const file=path.join(publicDir,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));return file;};
 const base='quality-improvement-mixed-full',summaryRelative=sourceRevision+'/summary.json',detailRelative=sourceRevision+'/candidate.json';
 const rowData=[['private-a','call-a','2026-10-26',36000,2,2,0,'private-cell-a','gnss'],['private-b','call-b','2026-10-26',36600,-1.5,1,1,'private-cell-b','rough'],['private-a','call-c','2026-10-27',86399.5,2.5,2.5,0,'private-cell-a','gnss']];
 const calls=rowData.map(row=>({date:row[2],callId:row[2]+':'+row[0]+':'+row[1],rawCallId:row[1],customerId:row[0],mos:row[5],sourceRevision}));
 const points=calls.map((call,index)=>({...call,lat:37.5+index*.0001,lon:127.05+index*.0001,kind:rowData[index][8],role:'discovery-member'}));
 const candidate={id:target.candidateId,memberCallIds:calls.map(c=>c.callId),poorCustomerCount:2,poorCallCount:3,poorDateCount:2,medoid:{lat:37.5,lon:127.05,kind:'gnss'},displayRadiusM:850,maxPairDistanceM:1614.6,rangeReviewRequired:true,nearbyPoints:points};
 const card={id:candidate.id,label:'후보 지역 1',poorCustomerCount:2,poorCallCount:3,poorDateCount:2,gnssCallCount:2,roughCallCount:1,displayRadiusM:850,rangeReviewRequired:true,rank:null,detailPath:detailRelative};
 const summary={schemaVersion:'quality-candidate-summary-v1',scope,scopeKey:target.candidateScope.scopeKey,locationMode:target.candidateScope.locationMode,discoveryDates:['2026-10-26','2026-10-27'],validationDates:[],candidates:[card]};
 const detail={schemaVersion:'quality-candidate-detail-v1',scope,scopeKey:summary.scopeKey,locationMode:summary.locationMode,candidate,calls,decisions:[]};
 const index={schemaVersion:'quality-improvement-index-v1',sourceRevision,analysisMode:'all',locationMode:summary.locationMode,entries:[{scope,scopeKey:summary.scopeKey,path:summaryRelative}]};
 const indexPath=write(base+'/index.json',index),summaryPath=write(base+'/'+summaryRelative,summary),detailPath=write(base+'/'+detailRelative,detail);
 const dbRelative='outputs/voice-query-data/fixture.sqlite',dbPath=path.join(root,dbRelative);fs.mkdirSync(path.dirname(dbPath),{recursive:true});
 const db=new DatabaseSync(dbPath);db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE calls(id TEXT PRIMARY KEY,raw_id TEXT,customer_id TEXT,date TEXT,start_second REAL,mos REAL,qoe REAL,is_drop INTEGER,cell TEXT,area TEXT,end_second REAL,json TEXT);
 CREATE TABLE days(customer_id TEXT,date TEXT,json TEXT,PRIMARY KEY(customer_id,date));`);
 db.prepare('INSERT INTO meta VALUES (?,?)').run('dataset',JSON.stringify({revision:sourceRevision,qoeBasis:'rtcp-mos-v5',dates:summary.discoveryDates}));
 const insert=db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
 for(const [customer,raw,date,second,qoe,mos,drop,cell] of rowData){
  insert.run(customer+':'+raw,raw,customer,date,second,mos,qoe,drop,cell,'private-area',second+10,JSON.stringify({contractId:'PRIVATE-CONTRACT'}));
 }
 for(const customer of ['private-a','private-b'])for(const date of summary.discoveryDates){
  const records=rowData.filter(r=>r[0]===customer&&r[2]===date).map(r=>({id:r[1],start:'10:00:00',end:'10:00:10',matchStatus:'MATCHED',hasMdt:true,rsrp:r[0]==='private-b'?null:-105,sinr:3,rtp:r[0]==='private-b'?{}:{txPacketLoss:2,rxPacketLoss:0,txJitter:14}}));
  db.prepare('INSERT INTO days VALUES (?,?,?)').run(customer,date,JSON.stringify({customerId:customer,date,calls:records,samples:[]}));
 }
 db.close();
 write('voice-query-index.json',{schemaVersion:'voice-query-index-v1',databaseSchema:'voice-query-db-v1',sourceRevision,database:dbRelative});
 write('voice-1030.json',{meta:{revision:sourceRevision}});
 return {root,publicDir,dbPath,sourceRevision,target,summary,detail,index,indexPath,summaryPath,detailPath,write};
}
function addAlternativeFixture(f,modelId='hdbscan'){
 const id=modelId+'-fixture',members=f.detail.candidate.nearbyPoints.map(p=>({...p}));
 const parameters={hdbscan:{minClusterSize:3,minSamples:2,distance:'Haversine'},st_dbscan:{epsSpaceM:100,epsTimeHours:48,minSamples:2},adaptive_kde:{kernel:'Gaussian',gnssBandwidthM:70,radioBandwidthM:160,candidateSupportM:180},spatial_scan:{radiiM:[100,200,400],permutations:99,population:'located-only'},bayesian:{method:'empirical Beta-Binomial',bandwidthM:200,priorStrength:20,dayDecay:.7}}[modelId];
 const candidate={id,lat:37.5,lon:127.05,radiusM:850,poorCustomers:2,poorCalls:3,days:2,gnssCalls:2,roughCalls:1,rangeReviewRequired:true,maxPairDistanceM:1614.6,members,validationPoints:[]};
 const report={schemaVersion:'quality-alternative-models-v1',sourceRevision:f.sourceRevision,scope:f.summary.scope,scopeKey:f.summary.scopeKey,analysisMode:'all',locationMode:f.summary.locationMode,discoveryDates:f.summary.discoveryDates,validationDates:[],models:{[modelId]:{status:'computed',parameters,candidates:[candidate]}}};
 const reportPath=f.write('quality-models-mixed-full/'+f.sourceRevision+'/report.json',report);
 f.write('quality-models-mixed-full/index.json',{schemaVersion:'quality-model-index-v1',sourceRevision:f.sourceRevision,analysisMode:'all',locationMode:f.summary.locationMode,entries:[{scope:f.summary.scope,scopeKey:f.summary.scopeKey,path:f.sourceRevision+'/report.json'}]});
 return {target:{...f.target,candidateId:id,candidateScope:{...f.target.candidateScope,modelId}},report,reportPath};
}
module.exports={createCandidateFixture,addAlternativeFixture};

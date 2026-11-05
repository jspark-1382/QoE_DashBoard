/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node scripts and the existing test harness require CommonJS imports. */
/* Local benchmark: reads published source summaries without modifying them. */
const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
const {createHash} = require('node:crypto');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {load} = require('./analyst-ts-loader.cjs');
const analytics = load('lib/analyst/overview-analytics.ts');
const overview = load('lib/analyst/overview.ts');
const dates = ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];
const calls = dates.flatMap(date => JSON.parse(fs.readFileSync(
  `public/analyst-overview/MDT/${date}.json`, 'utf8')).calls);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const measure = (name, run) => {
  run(); // Warm the same implementation before measuring.
  const times = [];
  let output;
  for(let i=0;i<5;i++) {
    const start=performance.now();
    output=run();
    times.push(performance.now()-start);
  }
  times.sort((a,b)=>a-b);
  return {name,medianMs:Number(times[2].toFixed(2)),outputHash:digest(output)};
};
// Optional ignored snapshots allow alternating old/new measurements in one
// process, with the exact same inputs and output hashes checked side by side.
const baselineDir=process.argv[2];
const loadBaseline=name=>{
  const source=fs.readFileSync(path.join(baselineDir,name+'-before.ts'),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText;
  const baselineModule={exports:{}};
  vm.runInThisContext('(function(require,module,exports){'+output+'\n})')(
    id=>id.startsWith('.')?load(path.resolve('lib/analyst',id)):require(id),baselineModule,baselineModule.exports,
  );
  return baselineModule.exports;
};
if(baselineDir){
  const oldAnalytics=loadBaseline('overview-analytics'),oldOverview=loadBaseline('overview');
  const compare=(name,before,after)=>{
    before();after();
    const oldTimes=[],newTimes=[];
    let oldOutput,newOutput;
    const run=(fn,times)=>{const start=performance.now(),result=fn();times.push(performance.now()-start);return result;};
    for(let i=0;i<7;i++){
      if(i%2){newOutput=run(after,newTimes);oldOutput=run(before,oldTimes);}
      else{oldOutput=run(before,oldTimes);newOutput=run(after,newTimes);}
    }
    oldTimes.sort((a,b)=>a-b);newTimes.sort((a,b)=>a-b);
    const oldHash=digest(oldOutput),newHash=digest(newOutput);
    if(oldHash!==newHash)throw new Error(name+' output changed');
    return {name,beforeMs:+oldTimes[3].toFixed(2),afterMs:+newTimes[3].toFixed(2),outputHash:newHash};
  };
  console.log(JSON.stringify({calls:calls.length,measurements:[
    compare('getOverviewAnalytics MOS',()=>oldAnalytics.getOverviewAnalytics(calls,'mos',3),()=>analytics.getOverviewAnalytics(calls,'mos',3)),
    compare('getHourlyCalls',()=>oldOverview.getHourlyCalls(calls,3),()=>overview.getHourlyCalls(calls,3)),
    compare('getOverviewSummary',()=>oldOverview.getOverviewSummary(calls,3),()=>overview.getOverviewSummary(calls,3)),
  ]},null,2));
}else console.log(JSON.stringify({calls:calls.length,measurements:[
  measure('getOverviewAnalytics MOS',()=>analytics.getOverviewAnalytics(calls,'mos',3)),
  measure('getHourlyCalls',()=>overview.getHourlyCalls(calls,3)),
  measure('getOverviewSummary',()=>overview.getOverviewSummary(calls,3)),
]},null,2));

/* eslint-disable @typescript-eslint/no-require-imports -- Test the local hook without a browser dependency. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {load}=require('../analyst-ts-loader.cjs');
const sourceFile='components/analyst/use-candidate-station-layer.ts';
const source=ts.transpileModule(fs.readFileSync(sourceFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const equal=(a,b)=>a?.length===b?.length&&a.every((value,index)=>Object.is(value,b[index]));
const catalog=technology=>({schemaVersion:technology==='NR'?'nr-station-catalog-v1':'lte-station-catalog-v1',technology,
  source:{file:'original-'+technology+'.xlsx',sha256:'a'.repeat(64),fileDate:null},
  summary:{inputRows:1,invalidRows:0,registeredCells:1,withPci:1,missingPci:0,invalidPci:0,conflictingPci:0,distinctPci:1},
  rows:[['ru-'+technology,'cell-'+technology,100,37.5,127,'valid']]});
function harness(fetch){
  const slots=[],effects=[];let cursor=0;
  const react={
    useState(initial){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};
      return [slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];},
    useMemo(fn,deps){const index=cursor++;if(!slots[index]||!equal(slots[index].deps,deps))slots[index]={value:fn(),deps};return slots[index].value;},
    useEffect(fn,deps){const index=cursor++;if(!slots[index]||!equal(slots[index].deps,deps))effects.push(()=>{
      slots[index]?.cleanup?.();slots[index]={deps,cleanup:fn()};
    });},
  };
  const mod={exports:{}};
  vm.runInNewContext(source,{module:mod,exports:mod.exports,fetch,AbortController,queueMicrotask,
    require:id=>id==='react'?react:load(path.resolve(path.dirname(sourceFile),id)),
  },{filename:sourceFile});
  return {
    render(){cursor=0;const result=mod.exports.useCandidateStationLayer();while(effects.length)effects.shift()();return result;},
    async settle(){await new Promise(resolve=>setImmediate(resolve));return this.render();},
    close(){for(const slot of slots)slot?.cleanup?.();},
  };
}

test('candidate stations start hidden without downloading LTE or 5G catalogs',async()=>{
  const requests=[],hook=harness(async url=>{requests.push(url);throw Error('must not fetch');});
  const value=await hook.settle();
  assert.equal(value.options.range,'off');assert.equal(value.options.rat,'LTE');assert.equal(value.options.highlightRelated,true);
  assert.equal(value.status,'off');assert.equal(value.catalogs.length,0);assert.deepEqual(requests,[]);hook.close();
});

test('turning stations on fetches selected catalogs once, and off hides cached towers',async()=>{
  const requests=[],hook=harness(async(url,{signal})=>{requests.push({url:String(url),signal});return {ok:true,json:async()=>catalog(String(url).includes('nr-')?'NR':'LTE')};});
  let value=hook.render();value.setOptions({...value.options,range:'inside'});hook.render();value=await hook.settle();
  assert.equal(value.status,'ready');assert.equal(value.catalogs.length,1);assert.equal(requests.length,1);assert.equal(requests[0].url,'/qoe/station-catalog.json');
  value.setOptions({...value.options,range:'off'});value=hook.render();assert.equal(value.status,'off');assert.equal(value.catalogs.length,0);
  value.setOptions({...value.options,range:'near'});hook.render();value=await hook.settle();
  assert.equal(value.status,'ready');assert.equal(requests.length,1,'completed original LTE data is reused');
  value.setOptions({...value.options,rat:'all'});hook.render();value=await hook.settle();
  assert.equal(value.catalogs.length,2);assert.equal(requests.length,2);assert.equal(requests[1].url,'/qoe/nr-station-catalog.json');hook.close();
});

test('switching off cancels an unfinished catalog request and never enables towers later',async()=>{
  let activeSignal,release;
  const hook=harness(async(_url,{signal})=>{activeSignal=signal;await new Promise(resolve=>{release=resolve;});return {ok:true,json:async()=>catalog('LTE')};});
  let value=hook.render();value.setOptions({...value.options,range:'inside'});hook.render();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(activeSignal.aborted,false);value=hook.render();value.setOptions({...value.options,range:'off'});hook.render();
  assert.equal(activeSignal.aborted,true);release();value=await hook.settle();
  assert.equal(value.status,'off');assert.equal(value.catalogs.length,0);hook.close();
});

test('disabled candidate station selection keeps every supplied catalog and point unchanged',()=>{
  const {DEFAULT_STATION_OPTIONS,selectCandidateStationSites}=load('lib/analyst/station-map-presentation.ts');
  const candidates=[{id:'candidate',location:{lat:37.5,lon:127,radiusM:100}}],catalogs=[catalog('LTE')];
  const rough=[{matchingCandidateIds:['candidate'],usedStations:[{ruId:'input-ru',cellId:'input-cell',lat:37.51,lon:127.01,rsrpDbm:-90}]}];
  const original=JSON.stringify({candidates,catalogs,rough});
  assert.deepEqual(selectCandidateStationSites(candidates,catalogs,DEFAULT_STATION_OPTIONS,'candidate',rough),[]);
  assert.equal(JSON.stringify({candidates,catalogs,rough}),original);
  assert(selectCandidateStationSites(candidates,catalogs,{...DEFAULT_STATION_OPTIONS,range:'inside'},'candidate',rough).length>0);
});

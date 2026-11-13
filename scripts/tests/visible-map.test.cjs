const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('lib/analyst/use-visible-map.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
function setup(ready,{observer=true}={}){
  const target={},frames=new Map(),enabled=[];let effect,instance,sequence=0;
  class Observer{
    constructor(callback){this.callback=callback;instance=this;this.disconnected=false;}
    observe(element){assert.equal(element,target);}
    disconnect(){this.disconnected=true;}
  }
  const module={exports:{}};
  vm.runInNewContext(source,{
    exports:module.exports,module,
    require:()=>({useRef:()=>({current:target}),useEffect:fn=>{effect=fn;}}),
    ...(observer?{IntersectionObserver:Observer}:{}),
    requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence;},
    cancelAnimationFrame:id=>frames.delete(id),
  });
  module.exports.useVisibleMap(ready,value=>enabled.push(value));
  const cleanup=effect();
  return {enabled,frames,cleanup,get observer(){return instance;},flush(){for(const fn of frames.values())fn();frames.clear();}};
}
test('summary must be ready before a map is observed or loaded',()=>{
  const state=setup(false);assert.equal(state.observer,undefined);assert.equal(state.frames.size,0);assert.deepEqual(state.enabled,[]);
});
test('offscreen map waits; visible map starts automatically after the summary paint',()=>{
  const state=setup(true);state.observer.callback([{isIntersecting:false}]);assert.equal(state.frames.size,0);
  state.observer.callback([{isIntersecting:true}]);assert.equal(state.observer.disconnected,true);
  assert.deepEqual(state.enabled,[]);state.flush();assert.deepEqual(state.enabled,[true]);
});
test('leaving the view cancels queued map loading, including a late frame callback',()=>{
  const state=setup(true);state.observer.callback([{isIntersecting:true}]);const callback=[...state.frames.values()][0];
  state.cleanup();callback();assert.equal(state.frames.size,0);assert.deepEqual(state.enabled,[]);
});
test('browsers without intersection support still load automatically after paint',()=>{
  const state=setup(true,{observer:false});assert.deepEqual(state.enabled,[]);state.flush();assert.deepEqual(state.enabled,[true]);
});

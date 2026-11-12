// Historical source assertions use the preserved original cohort; current sources have a separate census test.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node scripts and the existing test harness require CommonJS imports. */
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {Writable}=require('node:stream');
const {once}=require('node:events');
const {pathToFileURL}=require('node:url');
const ts=require('typescript');
const helperPath=path.resolve(__dirname,'../local-public-assets.cjs');
const {createPublicAssetHandler,isLocalPreviewBuild}=fs.existsSync(helperPath)?require(helperPath):{};

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-local-assets-'));
  t.after(()=>{
    assert(path.basename(root).startsWith('qoe-local-assets-'));
    fs.rmSync(root,{recursive:true,force:true});
  });
  fs.mkdirSync(path.join(root,'public'),{recursive:true});
  fs.mkdirSync(path.join(root,'dist/client'),{recursive:true});
  return root;
}
class Response extends Writable {
  constructor(){super();this.headers={};this.chunks=[];this.statusCode=200;}
  writeHead(status,headers={}){this.statusCode=status;this.headers=headers;this.headersSent=true;return this;}
  _write(chunk,encoding,done){this.chunks.push(Buffer.from(chunk));done();}
}
async function request(handler,url,options={}) {
  const res=new Response();
  const done=once(res,'finish');
  const handled=await handler({method:options.method??'GET',headers:options.headers??{}},res,url);
  if(!handled)res.end('delegated');
  await done;
  return {handled,status:res.statusCode,headers:res.headers,body:Buffer.concat(res.chunks)};
}
async function config(mode) {
  const configModule={exports:{}};
  const js=ts.transpileModule(historicalRead('vite.config.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(js,{
    module:configModule,exports:configModule.exports,process:{env:{}},
    require(id){
      if(id==='vite')return {defineConfig:value=>value};
      if(id==='@openai/sites-vite-plugin')return {sites:()=>({name:'sites'})};
      if(id==='@tailwindcss/postcss')return {default:()=>({})};
      if(id==='vinext')return {default:()=>({name:'vinext'})};
      if(id==='@cloudflare/vite-plugin')return {cloudflare:()=>({name:'cloudflare'})};
      if(id==='./.openai/hosting.json')return {default:{}};
      return require(id);
    },
  },{filename:'vite.config.ts'});
  return configModule.exports.default({mode,command:'build'});
}

test('only local-preview mode removes public route scanning and emits an external build marker',async t=>{
  const root=fixture(t);
  fs.writeFileSync(path.join(root,'public/source.json'),'{}');
  const local=await config('local-preview'),normal=await config('production');
  assert.equal(local.publicDir,false);
  assert.notEqual(normal.publicDir,false,'standard deploy build retains its public assets');
  const plugin=local.plugins.find(p=>p.name==='qoe:local-preview-build');
  assert(plugin,'local build must explicitly identify its static serving mode');
  assert(!normal.plugins.some(p=>p.name===plugin.name));
  await plugin.writeBundle.call({environment:{name:'client'}},{dir:path.join(root,'dist/client')});
  const marker=path.join(root,'dist/.qoe-local-preview.json');
  assert.deepEqual(JSON.parse(historicalRead(marker,'utf8')),{schemaVersion:1,mode:'local-preview'});
  assert(!fs.existsSync(path.join(root,'dist/client/.qoe-local-preview.json')),'marker is outside HTTP asset root');
  const {scanPublicFileRoutes}=await import(pathToFileURL(path.resolve('node_modules/vinext/dist/utils/public-routes.js')).href);
  assert.deepEqual(scanPublicFileRoutes(root,local.publicDir),[]);
  assert(scanPublicFileRoutes(root,'public').includes('/source.json'));
  const {cleanBuildOutput}=await import(pathToFileURL(path.resolve('node_modules/vinext/dist/build/clean-output.js')).href);
  cleanBuildOutput({root,outDir:path.join(root,'dist')});
  assert(!fs.existsSync(marker),'normal Vinext clean removes any previous local marker');
});

test('local marker is opt-in, versioned and never inferred from source public contents',t=>{
  assert.equal(typeof isLocalPreviewBuild,'function');
  const root=fixture(t),dist=path.join(root,'dist');
  assert.equal(isLocalPreviewBuild(dist),false);
  fs.writeFileSync(path.join(dist,'.qoe-local-preview.json'),JSON.stringify({schemaVersion:1,mode:'local-preview'}));
  assert.equal(isLocalPreviewBuild(dist),true);
  fs.writeFileSync(path.join(dist,'.qoe-local-preview.json'),JSON.stringify({schemaVersion:2,mode:'local-preview'}));
  assert.throws(()=>isLocalPreviewBuild(dist),/marker/i);
});

test('direct assets preserve bytes, HEAD, weak ETag revalidation and refreshed files without snapshots',async t=>{
  assert.equal(typeof createPublicAssetHandler,'function');
  const root=fixture(t),publicDir=path.join(root,'public');
  const file=path.join(publicDir,'voice.json');
  fs.writeFileSync(file,'{"calls":184232}');
  const handler=createPublicAssetHandler(publicDir);
  const first=await request(handler,'/qoe/voice.json');
  assert.equal(first.status,200);assert.equal(first.body.toString(),'{"calls":184232}');
  assert.equal(first.headers['Content-Type'],'application/json; charset=utf-8');
  assert.equal(first.headers['Cache-Control'],'no-cache');
  assert.equal(first.headers['X-Content-Type-Options'],'nosniff');
  const head=await request(handler,'/qoe/voice.json',{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(head.body.length,0);
  assert.equal(head.headers['Content-Length'],first.body.length);
  assert.equal(head.headers.ETag,first.headers.ETag);
  const fresh=await request(handler,'/qoe/voice.json',{headers:{'if-none-match':first.headers.ETag}});
  assert.equal(fresh.status,304);assert.equal(fresh.body.length,0);
  assert.equal((await request(handler,'/qoe/voice.json',{headers:{'if-modified-since':first.headers['Last-Modified']}})).status,304);
  fs.writeFileSync(file,'{"calls":1}');
  const changed=await request(handler,'/qoe/voice.json',{headers:{'if-none-match':first.headers.ETag,'if-modified-since':first.headers['Last-Modified']}});
  assert.equal(changed.status,200);assert.equal(changed.body.toString(),'{"calls":1}');
  const binary=Buffer.from([0,255,1,128]);
  fs.writeFileSync(path.join(publicDir,'icon.png'),binary);
  assert.deepEqual((await request(handler,'/qoe/icon.png')).body,binary);
  fs.writeFileSync(path.join(publicDir,'관측 자료.json'),'{}');
  assert.equal((await request(handler,'/qoe/'+encodeURIComponent('관측 자료.json'))).body.toString(),'{}');
  assert.equal((await request(handler,'/qoe/voice.json',{method:'POST'})).status,405);
  assert.equal((await request(handler,'/qoe/voice.json',{method:'POST'})).headers.Allow,'GET, HEAD');
  assert.equal((await request(handler,'/qoe/mos-lab')).handled,false,'application routes still delegate');
  assert.equal((await request(handler,'/qoe/')).handled,false,'main page still delegates');
});

test('encoded traversal, repeated separators, Windows paths, directories and symlink escapes are blocked',async t=>{
  assert.equal(typeof createPublicAssetHandler,'function');
  const root=fixture(t),publicDir=path.join(root,'public');
  const outside=path.join(root,'outside');fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside,'secret.json'),'private');
  fs.mkdirSync(path.join(publicDir,'folder'));
  fs.symlinkSync(outside,path.join(publicDir,'escape'),'junction');
  fs.writeFileSync(path.join(publicDir,'.qoe-local-preview.json'),'hidden');
  const handler=createPublicAssetHandler(publicDir);
  for(const url of ['/qoe/../outside/secret.json','/qoe/%2e%2e/outside/secret.json',
    '/qoe/%252e%252e/outside/secret.json','/qoe/%2foutside/secret.json',
    '/qoe/folder//secret.json','/qoe/folder\\secret.json','/qoe/%5csecret.json',
    '/qoe/voice.json:secret','/qoe/%00secret.json','/qoe/%E0%A4%A']){
    const result=await request(handler,url);
    assert.equal(result.handled,true,url);
    assert.equal(result.status,400,url);
    assert(!result.body.toString().includes('private'),url);
  }
  assert.equal((await request(handler,'/qoe/escape/secret.json')).status,403);
  assert.equal((await request(handler,'/qoe/folder')).status,404);
  assert.equal((await request(handler,'/qoe/.qoe-local-preview.json')).status,404);
});

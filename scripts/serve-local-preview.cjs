/* eslint-disable no-console */
/**
 * Local-only Vinext preview (127.0.0.1:3014 by default).
 * QOE_PREVIEW_DIST selects a distribution inside this workspace;
 * QOE_PREVIEW_PORT selects a separate local preview port.
 *
 * Vinext 1.0.0-beta.5 currently serves /qoe/ pages, but fails to recognize
 * their /qoe/_next/static/* build assets. The files exist at
 * dist/client/qoe/_next/static/*; the production app-router asset dispatcher
 * uses an empty assetPrefix when detecting requests.
 *
 * Serve prebuilt hashed assets and the local worker-backed voice query API;
 * delegate application routes to Vinext. Never expose externally.
 */
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {isLocalPreviewBuild,createPublicAssetHandler} = require('./local-public-assets.cjs');
const {createVoiceQueryHandler} = require('./voice-query-api.cjs');
const {createQwenAnalysisHandler} = require('./qwen-analysis-api.cjs');

const root=path.resolve(__dirname,'..');
function resolvePreviewConfig(env=process.env){
  const relative=String(env.QOE_PREVIEW_DIST??'dist').trim();
  const inside=(base,target)=>{
    const tail=path.relative(base,target);
    return !!tail && tail!=='..' && !tail.startsWith('..'+path.sep) && !path.isAbsolute(tail);
  };
  if(!relative || relative.includes('\0') || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || /^[a-z][a-z0-9+.-]*:/i.test(relative)){
    throw new Error('QOE_PREVIEW_DIST must be a relative directory inside the workspace');
  }
  const dist=path.resolve(root,relative);
  if(!inside(root,dist) || fs.existsSync(dist)&&!inside(fs.realpathSync(root),fs.realpathSync(dist))){
    throw new Error('QOE_PREVIEW_DIST must resolve to a directory inside the workspace');
  }
  const portText=String(env.QOE_PREVIEW_PORT??'3014').trim();
  const port=Number(portText);
  if(!/^\d+$/.test(portText) || !Number.isInteger(port) || port<1 || port>65535){
    throw new Error('QOE_PREVIEW_PORT must be an integer from 1 to 65535');
  }
  return {dist,port};
}
const {dist,port}=resolvePreviewConfig();
const assetRoot=path.join(dist,'client','qoe','_next','static');
const prefix='/qoe/_next/static/';
const types={
  '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.mjs':'application/javascript; charset=utf-8',
  '.woff2':'font/woff2',
  '.woff':'font/woff',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.jpeg':'image/jpeg',
  '.jpg':'image/jpeg',
  '.gif':'image/gif',
  '.webp':'image/webp',
  '.ico':'image/x-icon',
  '.json':'application/json; charset=utf-8',
  '.map':'application/json; charset=utf-8',
  '.wasm':'application/wasm',
};

async function serveLocalAsset(req,res,pathname){
  let relative;
  try{
    relative=decodeURIComponent(pathname.slice(prefix.length));
  }catch{
    res.writeHead(400);res.end('Bad URL');return;
  }
  const parts=relative.split('/');
  if(!relative || parts.some(part=>!part || part==='.' || part==='..' || /[\\\x00]/.test(part))){
    res.writeHead(400);res.end('Invalid asset path');return;
  }
  const ext=path.extname(relative).toLowerCase();
  if(!Object.prototype.hasOwnProperty.call(types,ext)){
    res.writeHead(403);res.end('Forbidden asset type');return;
  }
  const filename=path.resolve(assetRoot,...parts);
  if(!filename.startsWith(assetRoot+path.sep)){
    res.writeHead(403);res.end('Forbidden');return;
  }
  try{
    const [stat,real]=await Promise.all([fs.promises.stat(filename),fs.promises.realpath(filename)]);
    const realRoot=await fs.promises.realpath(assetRoot);
    if(!real.startsWith(realRoot+path.sep) || !stat.isFile()){
      res.writeHead(403);res.end('Forbidden');return;
    }
    res.writeHead(200,{
      'Content-Type':types[ext],
      'Content-Length':stat.size,
      'Cache-Control':'public, max-age=3600',
      'X-Content-Type-Options':'nosniff',
    });
    if(req.method==='HEAD'){res.end();return;}
    const stream=fs.createReadStream(filename);
    stream.on('error',()=>res.destroy());
    stream.pipe(res);
  }catch(err){
    if(err?.code==='ENOENT'){res.writeHead(404);res.end('Asset missing');return;}
    if(!res.headersSent){res.writeHead(500);res.end('Asset load error');}else res.destroy();
    console.error('[preview] local asset error',err);
  }
}

async function main(){
  if(!fs.existsSync(assetRoot)){
    throw new Error('Run npm.cmd run build before preview: '+assetRoot);
  }
  const servePublic=isLocalPreviewBuild(dist)
    ? createPublicAssetHandler(path.join(root,'public')) : null;
  const serveVoice=createVoiceQueryHandler({root});
  const serveAnalysis=createQwenAnalysisHandler({root});
  const {startProdServer}=await import(pathToFileURL(path.join(root,'node_modules/vinext/dist/server/prod-server.js')).href);
  const {server}=await startProdServer({
    port,
    host:'127.0.0.1',
    outDir:dist,
    silent:true,
  });
  const listeners=server.listeners('request');
  if(listeners.length!==1){
    await new Promise(resolve=>server.close(resolve));
    throw new Error('Unexpected Vinext handler layout; refusing to install preview adapter');
  }
  const delegate=listeners[0];
  server.once('close',()=>{void Promise.all([serveVoice.close(),serveAnalysis.close()]);});
  server.removeAllListeners('request');
  server.on('request',(req,res)=>{
    const pathname=(req.url??'/').split('?')[0];
    if(pathname.startsWith(prefix)){
      if(req.method!=='GET' && req.method!=='HEAD'){
        res.writeHead(405,{Allow:'GET, HEAD'});res.end('Method Not Allowed');return;
      }
      void serveLocalAsset(req,res,pathname);
    }else{
      void serveAnalysis(req,res,pathname).then(handled=>handled||serveVoice(req,res,pathname)).then(handled=>{
        if(handled)return;
        if(servePublic){
          return servePublic(req,res,pathname).then(publicHandled=>{
            if(!publicHandled)delegate.call(server,req,res);
          });
        }
        delegate.call(server,req,res);
      }).catch(()=>{if(!res.headersSent){res.writeHead(500);res.end('Asset unavailable');}else res.destroy();});
    }
  });
  console.log('[preview] Production UI + static assets: http://127.0.0.1:'+port+'/qoe/');
  console.log('[preview] Local only; source workbooks and original published data remain unchanged');
  if(servePublic)console.log('[preview] Local build: source public assets with revalidation');
}
module.exports={resolvePreviewConfig};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});

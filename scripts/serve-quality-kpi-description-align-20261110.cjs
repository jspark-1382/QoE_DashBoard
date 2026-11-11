/* eslint-disable no-console */
/**
 * Local-only Vinext preview (127.0.0.1:3014).
 *
 * Vinext 1.0.0-beta.5 currently serves /qoe/ pages, but fails to recognize
 * their /qoe/_next/static/* build assets. The files exist at
 * dist/client/qoe/_next/static/*; the production app-router asset dispatcher
 * uses an empty assetPrefix when detecting requests.
 *
 * Intercept ONLY the prebuilt hashed CSS/JS/font asset requests and delegate
 * every other request to the unmodified Vinext handler. Never expose externally.
 */
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {isLocalPreviewBuild,createPublicAssetHandler} = require('./local-public-assets.cjs');

const root=path.resolve(__dirname,'..');
const dist=path.join(root,'outputs','quality-improvement-two-deploy','stage-kpi-description-align-20261110','dist');
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
  const {startProdServer}=await import(pathToFileURL(path.join(root,'node_modules/vinext/dist/server/prod-server.js')).href);
  const {server}=await startProdServer({
    port:Number(process.env.QOE_IMPROVEMENT_TWO_PORT ?? '3019'),
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
  server.removeAllListeners('request');
  server.on('request',(req,res)=>{
    const pathname=(req.url??'/').split('?')[0];
    if(pathname.startsWith(prefix)){
      if(req.method!=='GET' && req.method!=='HEAD'){
        res.writeHead(405,{Allow:'GET, HEAD'});res.end('Method Not Allowed');return;
      }
      void serveLocalAsset(req,res,pathname);
    }else{
      if(servePublic){
        void servePublic(req,res,pathname).then(handled=>{
          if(!handled)delegate.call(server,req,res);
        }).catch(()=>{if(!res.headersSent){res.writeHead(500);res.end('Asset unavailable');}else res.destroy();});
      }else delegate.call(server,req,res);
    }
  });
  console.log('[preview] Quality improvement 2: http://127.0.0.1:'+String(process.env.QOE_IMPROVEMENT_TWO_PORT ?? '3019')+'/qoe/');
  console.log('[preview] Local only; original app and datasets remain unchanged');
  if(servePublic)console.log('[preview] Local build: source public assets with revalidation');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

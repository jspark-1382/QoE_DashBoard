/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node scripts and the existing test harness require CommonJS imports. */
const fs = require('node:fs');
const path = require('node:path');

const MARKER = '.qoe-local-preview.json';
const types = {
  '.json':'application/json; charset=utf-8', '.geojson':'application/geo+json; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.mjs':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.html':'text/html; charset=utf-8', '.txt':'text/plain; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.gif':'image/gif', '.ico':'image/x-icon',
  '.woff':'font/woff', '.woff2':'font/woff2', '.wasm':'application/wasm',
};

function isLocalPreviewBuild(dist) {
  let marker;
  try { marker=JSON.parse(fs.readFileSync(path.join(dist,MARKER),'utf8')); }
  catch(error) { if(error.code==='ENOENT')return false; throw new Error('Invalid local preview build marker'); }
  if(marker?.schemaVersion!==1 || marker.mode!=='local-preview')
    throw new Error('Invalid local preview build marker');
  return true;
}

/** Local-only source assets; normal builds continue serving their own snapshot. */
function createPublicAssetHandler(publicDir) {
  const realRoot=fs.realpathSync(publicDir);
  const respond=(res,status,text)=>{res.writeHead(status);res.end(text);return true;};
  return async function servePublicAsset(req,res,pathname) {
    if(res.destroyed)return true;
    if(!pathname.startsWith('/qoe/') || pathname==='/qoe/')return false;
    let relative;
    try {
      if(/%(?:2f|5c)/i.test(pathname))throw new Error('Encoded separator');
      relative=decodeURIComponent(pathname.slice('/qoe/'.length));
    }catch { return respond(res,400,'Invalid asset path'); }
    const parts=relative.split('/');
    // eslint-disable-next-line no-control-regex -- Explicitly reject controls in decoded asset paths.
    if(parts.some(part=>!part || part==='.' || part==='..' || /[\\%\x00-\x1f\x7f<>:"|?*]/.test(part) || /[. ]$/.test(part)))
      return respond(res,400,'Invalid asset path');
    if(parts.some(part=>part.startsWith('.')))return respond(res,404,'Not found');
    let handle;
    try {
      const filename=await fs.promises.realpath(path.join(realRoot,...parts));
      const contained=path.relative(realRoot,filename);
      if(contained==='..' || contained.startsWith('..'+path.sep) || path.isAbsolute(contained))
        return respond(res,403,'Forbidden');
      handle=await fs.promises.open(filename,'r');
      const stat=await handle.stat({bigint:true});
      if(res.destroyed)return true;
      if(!stat.isFile())return respond(res,404,'Not found');
      if(req.method!=='GET' && req.method!=='HEAD') {
        res.writeHead(405,{Allow:'GET, HEAD'});res.end('Method Not Allowed');return true;
      }
      const etag=`W/"${stat.size.toString(16)}-${stat.mtimeNs.toString(16)}"`;
      const modified=new Date(Number(stat.mtimeMs));
      const headers={
        'Content-Type':types[path.extname(filename).toLowerCase()]??'application/octet-stream',
        'Cache-Control':'no-cache', ETag:etag, 'Last-Modified':modified.toUTCString(),
        'X-Content-Type-Options':'nosniff',
      };
      const noneMatch=req.headers['if-none-match'];
      const unmodified=noneMatch!==undefined
        ? String(noneMatch).split(',').some(tag=>tag.trim()==='*' || tag.trim().replace(/^W\//,'')===etag.replace(/^W\//,''))
        : req.headers['if-modified-since']!==undefined &&
          Math.floor(modified.getTime()/1000)*1000<=Date.parse(String(req.headers['if-modified-since']));
      if(unmodified){res.writeHead(304,headers);res.end();return true;}
      res.writeHead(200,{...headers,'Content-Length':Number(stat.size)});
      if(req.method==='HEAD'){res.end();return true;}
      // fstat and stream share one open file: an atomic data refresh cannot
      // pair the previous file's ETag/length with a different file's body.
      const stream=handle.createReadStream();
      handle=null;
      stream.on('error',()=>res.destroy());
      res.once('close',()=>stream.destroy());
      stream.pipe(res);
      return true;
    }catch(error) {
      if(error.code==='ENOENT' || error.code==='ENOTDIR')return false;
      if(res.headersSent){res.destroy();return true;}
      return respond(res,error.code==='EACCES' || error.code==='EPERM'?403:500,'Asset unavailable');
    }finally { if(handle)await handle.close(); }
  };
}
module.exports={isLocalPreviewBuild,createPublicAssetHandler};

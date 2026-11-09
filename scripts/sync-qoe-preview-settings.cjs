/* eslint-disable @typescript-eslint/no-require-imports -- Local build helper. */
const fs=require('node:fs');
const path=require('node:path');

function syncPreviewMapSettings(sourceRoot,targetRoot){
  const source=fs.realpathSync(sourceRoot),target=path.resolve(targetRoot);
  const within=directory=>{
    const relative=path.relative(source,directory);
    return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
  };
  if(target===source)throw new Error('Preview must use a separate directory');
  if(!within(target))throw new Error('Preview must stay inside the workspace');
  let existing=target;
  while(!fs.existsSync(existing))existing=path.dirname(existing);
  const realExisting=fs.realpathSync(existing);
  if(realExisting!==source&&!within(realExisting))throw new Error('Preview must stay inside the workspace');
  const line=fs.readFileSync(path.join(source,'.env.local'),'utf8').split(/\r?\n/)
    .filter(value=>/^\s*VITE_VWORLD_API_KEY\s*=/.test(value)).at(-1);
  if(!line||!line.split('=').slice(1).join('=').trim())throw new Error('Existing VWorld map setting is missing');
  fs.mkdirSync(target,{recursive:true});
  if(!within(fs.realpathSync(target)))throw new Error('Preview must stay inside the workspace');
  const filename=path.join(target,'.env.local');
  if(fs.existsSync(filename)&&fs.lstatSync(filename).isSymbolicLink())throw new Error('Preview settings must be a regular file');
  const previous=fs.existsSync(filename)?fs.readFileSync(filename,'utf8'):'';
  const rest=previous.split(/\r?\n/).filter(value=>value&&!/^\s*VITE_VWORLD_API_KEY\s*=/.test(value));
  fs.writeFileSync(filename,[...rest,line.trim(),''].join('\n'),'utf8');
}
module.exports={syncPreviewMapSettings};
if(require.main===module){
  const target=process.argv[2];
  if(!target)throw new Error('Supply a preview output directory');
  syncPreviewMapSettings(path.resolve(__dirname,'..'),target);
  process.stdout.write('Existing VWorld setting applied to the local preview.\n');
}

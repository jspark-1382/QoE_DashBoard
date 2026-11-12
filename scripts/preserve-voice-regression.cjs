/* Preserve a private, immutable cohort for numerical UI regressions before a source refresh. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),pub=path.join(root,'public');
const manifest=JSON.parse(fs.readFileSync(path.join(pub,'voice-1030.json'),'utf8'));
const revision=manifest.meta.revision;
if(!/^[a-f0-9]{20}$/.test(revision))throw Error('Invalid source revision');
const output=path.join(root,'outputs/published-fixtures',revision);
const marker=path.join(output,'fixture.json');
if(fs.existsSync(marker)){console.log('Historical fixture already preserved: '+revision);process.exit(0);}
const folders=['analyst-overview','three-site-rough','customer-screening-data','gps-map-stations',
 'quality-improvement','quality-improvement-full','quality-models','quality-models-full',
 'quality-improvement-mixed-full','quality-improvement-mixed-evaluation',
 'quality-models-mixed-full','quality-models-mixed-evaluation','voice-improvement-1'];
let files=0;
function copy(source,dest){
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 fs.copyFileSync(source,dest);files++;
}
function walk(source,dest){
 if(!fs.existsSync(source))return;
 for(const entry of fs.readdirSync(source,{withFileTypes:true})){
  if(entry.isDirectory()&&!/^[a-f0-9]{20}$/.test(entry.name))walk(path.join(source,entry.name),path.join(dest,entry.name));
  else if(entry.isFile()&&entry.name.endsWith('.json'))copy(path.join(source,entry.name),path.join(dest,entry.name));
 }
}
copy(path.join(pub,'voice-1030.json'),path.join(output,'public/voice-1030.json'));
for(const folder of folders)walk(path.join(pub,folder),path.join(output,'public',folder));
copy(path.join(root,'outputs/voice-1030-quality-report.json'),path.join(output,'source-audit.json'));
fs.writeFileSync(marker,JSON.stringify({schemaVersion:'published-regression-fixture-v1',sourceRevision:revision,
 totalCalls:manifest.meta.totalCalls,files,note:'Immutable private historical cohort. Revision directories remain in public.'}));
console.log(JSON.stringify({revision,files,output}));

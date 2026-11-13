/* Exact historical counts describe the original two-workbook cohort, not future data additions.
 * Active expanded-source census is checked separately in current-voice-source.test.cjs.
 */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),publicRoot=path.join(root,'public');
const originalRevision='79840583bdb8e36221c2';
const fixture=path.join(root,'outputs/published-fixtures',originalRevision);
const available=fs.existsSync(path.join(fixture,'fixture.json'));
const forceActive=process.env.QOE_TEST_ACTIVE_SOURCE==='1';
const preserved=!forceActive&&available;
const cache=new Map();
function requiresHistoricalFixture(hasFixture,activeRevision,activeRequested){
 return !activeRequested&&!hasFixture&&activeRevision!==originalRevision;
}
function skipHistoricalSource(filename){
 if(preserved||forceActive)return false;
 let revision=null,handle;
 try{
  handle=fs.openSync(path.join(publicRoot,'voice-1030.json'),'r');
  const buffer=Buffer.alloc(16384),length=fs.readSync(handle,buffer,0,buffer.length,0);
  revision=/"revision"\s*:\s*"([a-f0-9]{20})"/.exec(buffer.toString('utf8',0,length))?.[1];
 }finally{if(handle!==undefined)fs.closeSync(handle);}
 if(!requiresHistoricalFixture(available,revision,forceActive))return false;
 require('node:test').test('Historical cohort: '+path.basename(filename),{
  skip:'Private original-cohort fixture unavailable. Restore outputs/published-fixtures/'+originalRevision+
       '; active-source census remains mandatory.'
 },()=>{});
 return true;
}
function historicalPath(file){
 if(typeof file!=='string')return file;
 const absolute=file.startsWith('../../public/')?path.resolve(__dirname,file):path.resolve(file);
 if(!preserved)return absolute;
 if(absolute===path.join(root,'outputs/voice-1030-quality-report.json'))return path.join(fixture,'source-audit.json');
 const relative=path.relative(publicRoot,absolute);
 if(relative===''||relative.startsWith('..')||path.isAbsolute(relative))return absolute;
 const frozen=path.join(fixture,'public',relative);
 // Content-versioned partitions/reports remain untouched in public after refresh.
 return fs.existsSync(frozen)?frozen:absolute;
}
function historicalRead(file,...args){return fs.readFileSync(historicalPath(file),...args);}
function historicalJson(file){
 const resolved=historicalPath(file);
 if(!cache.has(resolved))cache.set(resolved,JSON.parse(fs.readFileSync(resolved,'utf8')));
 return cache.get(resolved);
}
module.exports={historicalRead,historicalJson,requiresHistoricalFixture,skipHistoricalSource};

/* On-demand export audit: consume the stream without retaining a bulk CSV. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const index=JSON.parse(fs.readFileSync('public/voice-query-index.json','utf8'));
const {createQueryEngine}=require('../voice-query-engine.cjs');
const engine=createQueryEngine({dbPath:path.resolve(index.database)});
const scope={dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'};
let bytes=0,lines=0,chunks=0,peakRss=0;
const started=performance.now();
for(const chunk of engine.exportCsv({sourceRevision:index.sourceRevision,scope})){
  bytes+=Buffer.byteLength(chunk);lines+=(chunk.match(/\r\n/g)??[]).length;chunks++;
  peakRss=Math.max(peakRss,process.memoryUsage().rss);
}
assert.equal(lines-1,7296);
console.log(JSON.stringify({op:'full-default-csv-export',rows:lines-1,bytes,chunks,ms:Math.round(performance.now()-started),peakRssMiB:Math.round(peakRss/1048576)}));engine.close();

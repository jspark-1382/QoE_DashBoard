/* Builds a display-only RF sidecar for original, approved GPS locations.
 * Never edits original CDR, MDT, GNSS evidence, or candidate decisions.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dataRoot = path.resolve(process.env.QOE_PUBLIC_DIR || path.join(root, 'public'));
const output = path.join(dataRoot, 'quality-improvement', 'gps-marker-rf-v1.json');
const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, 'voice-1030.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(dataRoot, 'quality-improvement', 'index.json'), 'utf8'));
const dayPath = new Map(manifest.days.map(d => [d.date + '|' + d.customerId, d.dataPath]));
const rfByCall = {};
const bands = {1550:'1800-wide', 1694:'1800-narrow', 3743:'900', 475:'2100'};
const stats = {matched:0, missing:0, red:0, green:0, unknown:0, bands:{}};

for (const {date, path: evidencePath} of index.evidence) {
  const evidence = JSON.parse(fs.readFileSync(path.join(dataRoot, 'quality-improvement', evidencePath), 'utf8'));
  if (evidence.revision !== index.sourceRevision || evidence.policy !== 'strict-3-site-v1')
    throw new Error('Evidence revision or location policy mismatch: ' + date);
  const overview = JSON.parse(fs.readFileSync(path.join(dataRoot,'analyst-overview','MDT',date+'.json'),'utf8'));
  if (overview.sourceRevision !== index.sourceRevision) throw new Error('Overview revision mismatch: ' + date);
  const low = new Map(overview.calls.filter(c=>typeof c.mos === 'number' && c.mos>=1 && c.mos<3)
    .map(c=>[date+':'+c.id,c]));
  const days = new Map();
  for (const record of evidence.records) {
    if (record.status !== 'accepted' || record.mdtLinkStatus !== 'unique' ||
        record.kind !== 'gnss' || record.reasons?.length || !low.has(record.callId)) continue;
    const call = low.get(record.callId);
    const relative = dayPath.get(date+'|'+call.customerId);
    if (!relative || relative.startsWith('/') || relative.includes('..')) throw new Error('Missing or unsafe MDT partition: '+record.callId);
    let partition = days.get(relative);
    if (!partition) {
      partition = JSON.parse(fs.readFileSync(path.join(dataRoot,relative),'utf8'));
      if (partition.date!==date || partition.customerId!==call.customerId)
        throw new Error('MDT partition identity mismatch: '+record.callId);
      days.set(relative, partition);
    }
    const originalCallId = call.rawCallId;
    const at = Date.parse(record.observedAt);
    if (!originalCallId || !Number.isFinite(at)) {stats.missing++;continue;}
    const samples = partition.samples.filter(row=>row[19]===originalCallId && Number.isFinite(Date.parse(row[21]?.timestamp)) &&
      Date.parse(row[21].timestamp)===at);
    if (samples.length !== 1) {stats.missing++;continue;} // No guessed RF time alignment
    const sample=samples[0];
    const frequency=sample[21]?.frequency;
    const earfcn=typeof frequency==='number' && Number.isInteger(frequency) ? frequency : null;
    const rsrp=typeof sample[10]==='number' && Number.isFinite(sample[10]) && sample[10]>=-160 && sample[10]<=-25 ? sample[10] : null;
    const band=earfcn===null?'other':bands[earfcn]??'other';
    const offsetSec=Math.abs(Date.parse(sample[21].timestamp)-at)/1000;
    const rec={callId:record.callId,date,observedAt:record.observedAt,mdtObservedAt:sample[21].timestamp,
      sampleDeltaSec:offsetSec,earfcn,band,rsrpDbm:rsrp,
      matchedBy:'source-date-customer-call-and-observed-time'};
    rfByCall[record.callId]=rec;
    stats.matched++;
    stats.bands[band]=(stats.bands[band]??0)+1;
    if (rsrp===null)stats.unknown++;
    else if(rsrp<=-105)stats.red++;
    else stats.green++;
  }
}
const result={schemaVersion:'qoe-gps-marker-rf-v1',sourceRevision:index.sourceRevision,
  scope:'approved-low-qoe-gnss',timeToleranceSeconds:0,
  earfcnMap:bands,thresholdDbm:-105,stats,records:rfByCall};
fs.writeFileSync(output,JSON.stringify(result),'utf8');
console.log(JSON.stringify({output,stats,bytes:fs.statSync(output).size},null,2));

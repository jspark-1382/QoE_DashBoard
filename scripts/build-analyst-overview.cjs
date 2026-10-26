/* eslint-disable @typescript-eslint/no-require-imports */
// Builds compact overview records from one detail partition at a time; source inputs are read-only.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { load } = require('./analyst-ts-loader.cjs');
const { normalizeDay } = load('lib/analyst/data.ts');
const { appendOverview, getOverviewSummary } = load('lib/analyst/overview.ts');
const publicDir = path.resolve(__dirname, '../public');
for (const [source, filename, folder] of [
  ['MDT', 'mdt-data.json', 'MDT'],
  ['실측', 'executive-data.json', 'measured'],
]) {
  if (process.argv[2] && process.argv[2] !== folder) continue;
  const inputPath=path.join(publicDir,filename);
  if(!fs.existsSync(inputPath)){
    if(process.argv[2])throw new Error(`Missing source dataset: ${filename}`);
    console.log(`Skip optional source: ${filename}`);
    continue;
  }
  const input = fs.readFileSync(inputPath);
  const dataset = JSON.parse(input);
  const revision = dataset.meta.revision;
  for (const date of dataset.meta.dates) {
    const overview = {
      schemaVersion: 'analyst-overview-v1',
      analyticsVersion: 'overview-analytics-v1',
      source,
      date,
      ...(revision ? { sourceRevision: revision } : {}),
      gridSizeM: 60,
      calls: [],
      cells: [],
    };
    let count = 0,
      noMdt = 0;
    for (const entry of dataset.days) {
      if (entry.date !== date) continue;
      const detail = entry.dataPath
        ? JSON.parse(
            fs.readFileSync(path.join(publicDir, entry.dataPath), 'utf8'),
          )
        : entry;
      if (detail.customerId !== entry.customerId || detail.date !== date)
        throw Error('Partition identity mismatch');
      const day = normalizeDay(dataset, detail, source);
      noMdt += day.calls.filter((c) => !c.hasMdt).length;
      appendOverview(overview, day);
      count++;
      if (count % 1000 === 0)
        console.log(
          `${source} ${date}: ${count} partitions / ${overview.calls.length} calls`,
        );
    }
    const target = path.join(publicDir, 'analyst-overview', folder);
    fs.mkdirSync(target, { recursive: true });
    const output = path.join(target, date + '.json'),
      temporary = output + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    // Atomic rename publishes a complete summary; the manifest and workbooks are never changed.
    try {
      fs.writeFileSync(temporary, JSON.stringify(overview));
      fs.renameSync(temporary, output);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    console.log(
      JSON.stringify({
        source,
        date,
        partitions: count,
        noMdt,
        ...getOverviewSummary(
          overview.calls,
          dataset.meta.poorQoeThreshold ?? 2.5,
        ),
        cells: overview.cells.length,
        bytes: fs.statSync(output).size,
      }),
    );
  }
}

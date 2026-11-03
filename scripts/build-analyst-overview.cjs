/* eslint-disable @typescript-eslint/no-require-imports */
// Builds compact overview records from one detail partition at a time; source inputs are read-only.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { load } = require('./analyst-ts-loader.cjs');
const { normalizeDay } = load('lib/analyst/data.ts');
const { appendOverview, getOverviewSummary } = load('lib/analyst/overview.ts');
const publicDir = path.resolve(__dirname, '../public');
for (const [source, filename, folder] of [
  ['MDT', 'voice-1030.json', 'MDT'],
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
    const normalizedPoints = [];
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
      if (source === 'MDT' && dataset.meta.qoeBasis === 'rtcp-mos-v5') {
        // Every call uses the same endpoint rule, independent of its MOS.
        // The CDR END TIME is the best available proxy for SIP BYE timing.
        // Never change the original GNSS trajectory stored in detail samples.
        const endMsByCall = new Map((detail.calls ?? []).map(call => [
          call.id, Date.parse(call.endTimestamp ?? ''),
        ]));
        for (const sample of day.samples) {
          if (sample.lat == null || sample.lon == null) continue;
          if (!['gnss','measured','radio','interpolated'].includes(sample.locationSource)) continue;
          const endMs = endMsByCall.get(sample.callId);
          normalizedPoints.push({
            callId: `${day.customerId}:${sample.callId}`,
            lat: sample.lat,
            lon: sample.lon,
            source: sample.locationSource,
            // Epoch milliseconds; unambiguous across date boundaries.
            observedMs: sample.timestamp,
            cdrEndMs: Number.isFinite(endMs) ? endMs : null,
            sampleIndex: sample.index,
            estimationMethod: sample.locationSource === 'gnss' ? 'GNSS' : sample.estimation?.method ?? 'UNKNOWN',
            siteCount: sample.estimation?.siteCount ?? null,
            geometry: sample.estimation?.geometry ?? null,
            residualErrorM: sample.estimation?.residualErrorM ?? null,
            estimatedAccuracyM: sample.accuracyM ?? null,
            confidenceScore: sample.confidence ?? null,
            estimatorWindowSec: sample.estimation?.windowSec ?? null,
          });
        }
      }
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
    // Atomic rename publishes the final district-mapped summary, never an intermediate 60m grid.
    const pointsFile = temporary + '.normalized-points.json';
    try {
      fs.writeFileSync(temporary, JSON.stringify(overview));
      if (source === 'MDT' && dataset.meta.qoeBasis === 'rtcp-mos-v5') {
        // Join against the real SHP in projected metres. The Python step is fail-closed.
        fs.writeFileSync(pointsFile, JSON.stringify(normalizedPoints));
        const mapper = spawnSync(process.env.PYTHON || 'python', [
          path.join(__dirname, 'administrative_dong.py'),
          '--overview', temporary,
          '--manifest', inputPath,
          '--public-dir', publicDir,
          '--points', pointsFile,
          '--shp', path.resolve(__dirname, '../data/행정동경계/BND_ADM_DONG_PG.shp'),
          '--bye-catalog', path.resolve(__dirname, '../data/BaseStation/수도권_LTE_261103.xlsx'),
        ], {
          cwd: path.resolve(__dirname, '..'),
          encoding: 'utf8',
          timeout: 120000,
          maxBuffer: 1024 * 1024,
        });
        if (mapper.error || mapper.status !== 0) {
          throw new Error('행정동 SHP 공간 매핑 실패: ' +
            (mapper.error?.message || mapper.stderr || mapper.stdout || mapper.status));
        }
        console.log(mapper.stdout.trim());
      }
      fs.renameSync(temporary, output);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      if (fs.existsSync(pointsFile)) fs.unlinkSync(pointsFile);
    }
    const published = source === 'MDT' && dataset.meta.qoeBasis === 'rtcp-mos-v5'
      ? JSON.parse(fs.readFileSync(output, 'utf8')) : overview;
    console.log(
      JSON.stringify({
        source,
        date,
        partitions: count,
        noMdt,
        ...getOverviewSummary(
          published.calls,
          dataset.meta.poorQoeThreshold ?? 2.5,
        ),
        spatialUnit: published.spatialUnit ?? 'grid60',
        cells: published.cells.length,
        boundaries: published.administrativeDongs?.length ?? 0,
        bytes: fs.statSync(output).size,
      }),
    );
  }
}

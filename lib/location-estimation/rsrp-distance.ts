import { RSRP_RADIUS_TABLE, SITE_CALIBRATION_TABLES } from './config';
export function estimateBaseRadius(rsrp: number, mode = 'default', siteKey?: string): number | null {
  if (!Number.isFinite(rsrp)) return null;
  const table = mode === 'site-specific' ? SITE_CALIBRATION_TABLES[siteKey ?? ''] : RSRP_RADIUS_TABLE;
  if (!table?.length) return null; // Never silently substitute an uncalibrated site table.
  if (rsrp <= table[0].rsrp) return table[0].radiusM;
  for (let i = 1; i < table.length; i++) {
    if (rsrp <= table[i].rsrp) {
      const a = table[i - 1], b = table[i];
      return a.radiusM + (b.radiusM - a.radiusM) * (rsrp - a.rsrp) / (b.rsrp - a.rsrp);
    }
  }
  return table[table.length - 1].radiusM;
}

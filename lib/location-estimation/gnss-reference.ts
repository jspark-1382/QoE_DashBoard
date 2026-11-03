/** Temporal GNSS reference: a last observed FIX, never an interpolated handset point.
 * A movement envelope is an assumed screening bound, NOT a confidence interval.
 */
export const GNSS_REFERENCE_POLICY = {
  maxAgeSeconds:180,
  assumedMaxSpeedKmh:120,
  assumedGnssOffsetM:250,
} as const;

export type GnssReference = {
  lat:number; lon:number;
  observedAt:number; targetAt:number;
  ageSeconds:number;
  movementRadiusM:number;
  method:'last-observed-gnss';
};

export type TimedGnssFix = {
  timestamp:number; lat:number|null; lon:number|null;
  locationSource:string;
};

export function makeGnssReference(
  fix:TimedGnssFix,
  targetAt:number,
  policy=GNSS_REFERENCE_POLICY,
):GnssReference|null {
  if(!Number.isFinite(targetAt)||!Number.isFinite(fix.timestamp)||
     !['gnss','measured'].includes(fix.locationSource)||
     fix.lat==null||fix.lon==null||
     !Number.isFinite(fix.lat)||!Number.isFinite(fix.lon)||
     Math.abs(fix.lat)>90||Math.abs(fix.lon)>180||
     (fix.lat===0&&fix.lon===0))return null;
  const ageSeconds=(targetAt-fix.timestamp)/1000;
  // Never borrow a GNSS observation from the future or another call.
  if(ageSeconds<0||ageSeconds>policy.maxAgeSeconds)return null;
  return {
    lat:fix.lat,lon:fix.lon,
    observedAt:fix.timestamp,targetAt,ageSeconds,
    movementRadiusM:Math.round(policy.assumedGnssOffsetM+
      ageSeconds*policy.assumedMaxSpeedKmh/3.6),
    method:'last-observed-gnss',
  };
}

export function latestGnssReference(
  rows:readonly TimedGnssFix[], targetAt:number,
  policy=GNSS_REFERENCE_POLICY,
):GnssReference|null {
  let latest:GnssReference|null=null;
  for(const row of rows){
    const candidate=makeGnssReference(row,targetAt,policy);
    if(candidate&&(!latest||candidate.observedAt>latest.observedAt))latest=candidate;
  }
  return latest;
}

/** Display duration in whole seconds; original fractional seconds remain unchanged in data. */
export function formatCallDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '미제공';
  const rounded=Math.round(seconds);
  const minutes=Math.floor(rounded/60);
  const remainder=rounded%60;
  const hours=Math.floor(minutes/60);
  if(hours>0)return String(hours).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')+':'+String(remainder).padStart(2,'0');
  return String(minutes).padStart(2,'0')+':'+String(remainder).padStart(2,'0');
}

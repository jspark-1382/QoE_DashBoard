/** Convert legacy source-report labels for display without modifying raw evidence or IDs. */
export function displayQualityLabel(value: string): string {
  return value.replace(/MOS/g, 'QoE');
}

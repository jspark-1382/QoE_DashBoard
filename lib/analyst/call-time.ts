// Chronology must never inherit timeToSecond's legacy invalid-clock fallback to zero.
const validDate = (date: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

export function parseFullTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  if (
    !match ||
    !validDate(match[1]) ||
    +match[2] > 23 ||
    +match[3] > 59 ||
    +match[4] > 59
  )
    return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function normalizeStartTimestamp(
  explicit: unknown,
  date: string,
  clock: string,
): string | undefined {
  // Present but invalid metadata is unknown; do not substitute a different date.
  if (explicit !== undefined) {
    return parseFullTimestamp(explicit) == null
      ? undefined
      : (explicit as string);
  }
  const match = clock.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/);
  if (
    !validDate(date) ||
    !match ||
    +match[1] > 23 ||
    +match[2] > 59 ||
    +(match[3] ?? 0) > 59
  )
    return undefined;
  return `${date}T${match[1].padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}${match[4] ?? ''}+09:00`;
}

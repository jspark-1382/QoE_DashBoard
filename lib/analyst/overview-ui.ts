/** Display aliases are based on the complete day's inventory, never a filtered rank. */
export function getAreaLabels(cells: { id: string; label?: string }[]) {
  return new Map(
    [...cells]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((cell, index) => [
        cell.id,
        cell.label?.trim() && !cell.label.trim().startsWith('grid60:')
          ? cell.label
          : `조사구역 ${index + 1}`,
      ]),
  );
}
export function getHourlyDisplay(
  bin: { poor: number; evaluated: number; total: number },
  mode: 'count' | 'rate',
) {
  const value =
    mode === 'count'
      ? bin.poor
      : bin.evaluated
        ? (bin.poor / bin.evaluated) * 100
        : null;
  return {
    value,
    label:
      value === null
        ? '평가 불가'
        : mode === 'rate'
          ? `${value.toFixed(1)}%`
          : `${value}`,
    context:
      bin.total === 0
        ? '통화 없음'
        : `평가 가능 ${bin.evaluated} / 전체 ${bin.total}통화`,
  };
}

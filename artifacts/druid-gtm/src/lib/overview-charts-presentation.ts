// LS5 — pure presentation helpers for the Overview charts. Formatting
// only, no interpretation of the underlying canonical counts.

/** "2026-08-15" -> "Aug 15" — a compact axis label, never a re-timezoned date (the input is already the canonical UTC calendar date). */
export function formatChartDayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  if (!month || !day) return isoDate;
  const date = new Date(Date.UTC(2000, Number(month) - 1, Number(day)));
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

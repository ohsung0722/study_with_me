// Korean duration wording shared by the record board and the seat note.

/** 3900 → '1시간 5분' (floored). */
export function formatHoursMinutes(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
}

/** Total hours with at most one decimal: 5400 → '1.5', 10800 → '3'. */
export function formatTotalHours(sec: number): string {
  return String(Math.round(Math.max(0, sec) / 360) / 10);
}

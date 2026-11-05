import { DAY_START_HOUR, NIGHT_START_HOUR } from './constants';

const KST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** 'YYYY-MM-DD' of the Asia/Seoul (fixed UTC+9) calendar day containing ms. */
export function kstDayKey(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Split [startMs, endMs) at every KST midnight. Empty/inverted ranges yield []. */
export function splitAtKstMidnight(
  startMs: number,
  endMs: number,
): { dayKey: string; startMs: number; endMs: number }[] {
  const parts: { dayKey: string; startMs: number; endMs: number }[] = [];
  let cur = startMs;
  while (cur < endMs) {
    const nextMidnight = Math.floor((cur + KST_OFFSET_MS) / DAY_MS) * DAY_MS + DAY_MS - KST_OFFSET_MS;
    const partEnd = Math.min(endMs, nextMidnight);
    parts.push({ dayKey: kstDayKey(cur), startMs: cur, endMs: partEnd });
    cur = partEnd;
  }
  return parts;
}

export function isNightHour(hour: number): boolean {
  return hour >= NIGHT_START_HOUR || hour < DAY_START_HOUR;
}

const p2 = (n: number) => String(n).padStart(2, '0');

export function formatHMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`;
}

export function formatMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${p2(Math.floor(s / 60))}:${p2(s % 60)}`;
}

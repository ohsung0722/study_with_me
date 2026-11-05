// Small time helpers for the Game: dev hour override and my live "today" total.
import { kstDayKey, splitAtKstMidnight, type Status } from '@studyverse/shared';

/** Dev flag `?hour=21`: force the local hour used for the day/night theme. Integer 0–23, else null. */
export function devHourFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('hour');
  if (raw === null || !/^\d{1,2}$/.test(raw)) return null;
  const h = Number(raw);
  return h >= 0 && h <= 23 ? h : null;
}

/**
 * My study seconds today (KST): the server's stored total (`base`, for `base.day`) plus today's part of the
 * live session. A stored total from an earlier day no longer counts.
 */
export function liveTodaySec(base: { sec: number; day: string }, status: Status, serverNow: number): number {
  const day = kstDayKey(serverNow);
  let sec = base.day === day ? base.sec : 0;
  if (status.kind === 'studying') {
    let ms = 0;
    for (const part of splitAtKstMidnight(status.startedAt, serverNow)) if (part.dayKey === day) ms += part.endMs - part.startMs;
    sec += Math.floor(ms / 1000);
  }
  return sec;
}

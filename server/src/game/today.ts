import { kstDayKey, splitAtKstMidnight, type Status, type TodayStats } from '@studyverse/shared';
import type { RecordStore } from '../store/store';

export interface LivePlayer { anonId: string; nickname: string; isNpc: boolean; status: Status }

const HIDDEN_NAME = '익명';

/** Stored sessions of today (KST) plus the today-part of every open studying session. NPCs excluded. */
export function computeToday(store: RecordStore, buildingId: string, players: Iterable<LivePlayer>, now: number): TodayStats {
  const day = kstDayKey(now);
  const base = store.todayStats(day, buildingId);
  let top = base.top5.map((e) => ({ ...e }));
  let people = base.people;
  let liveMs = 0;

  for (const p of players) {
    if (p.isNpc || p.status.kind !== 'studying') continue;
    let ms = 0;
    for (const part of splitAtKstMidnight(p.status.startedAt, now)) {
      if (part.dayKey === day) ms += part.endMs - part.startMs;
    }
    if (ms <= 0) continue;
    liveMs += ms;
    const stored = store.userDaySec(p.anonId, day);
    if (stored === 0) people++;
    if (p.nickname === HIDDEN_NAME) continue; // hidden users never appear in the top 5
    const i = top.findIndex((e) => e.nickname === p.nickname && e.sec === stored);
    if (i >= 0) top.splice(i, 1);
    top.push({ nickname: p.nickname, sec: stored + Math.floor(ms / 1000) });
  }

  top.sort((a, b) => b.sec - a.sec || (a.nickname < b.nickname ? -1 : a.nickname > b.nickname ? 1 : 0));
  return { dayKey: day, people, totalSec: base.totalSec + Math.floor(liveMs / 1000), top5: top.slice(0, 5) };
}

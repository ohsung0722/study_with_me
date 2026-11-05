// "오늘 이 자리에서 …" note under the sit prompt: per-seat cache of the server's seatToday answer (30 s).
import { formatHoursMinutes } from '../ui/format';

export const SEAT_TODAY_TTL_MS = 30_000;

export function seatTodayText(sec: number): string {
  return `오늘 이 자리에서 ${formatHoursMinutes(sec)} 공부했어요`;
}

export class SeatTodayCache {
  private cache = new Map<string, { sec: number; at: number }>();
  private inflight = new Set<string>();

  constructor(
    private fetch: (seatId: string) => Promise<number>,
    private now: () => number = Date.now,
    private ttlMs = SEAT_TODAY_TTL_MS,
  ) {}

  /** Cached seconds (possibly stale) or undefined; starts a refresh when missing or older than the TTL. */
  get(seatId: string): number | undefined {
    const hit = this.cache.get(seatId);
    const t = this.now();
    if ((!hit || t - hit.at >= this.ttlMs) && !this.inflight.has(seatId)) {
      this.inflight.add(seatId);
      this.fetch(seatId).then(
        (sec) => { this.inflight.delete(seatId); this.cache.set(seatId, { sec, at: this.now() }); },
        () => { this.inflight.delete(seatId); /* retried on the next get */ },
      );
    }
    return hit?.sec;
  }
}

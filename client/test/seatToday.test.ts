import { describe, expect, test, vi } from 'vitest';
import { SeatTodayCache, seatTodayText } from '../src/game/seatToday';

describe('SeatTodayCache', () => {
  test('fetches once per seat per 30 s; returns cached value meanwhile', async () => {
    let now = 0;
    const fetch = vi.fn(async (seatId: string) => (seatId === 'R01' ? 3900 : 60));
    const c = new SeatTodayCache(fetch, () => now);
    expect(c.get('R01')).toBeUndefined();
    expect(c.get('R01')).toBeUndefined(); // in flight → no second request
    expect(fetch).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(c.get('R01')).toBe(3900);

    now = 29_999;
    expect(c.get('R01')).toBe(3900);
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 30_000;
    expect(c.get('R01')).toBe(3900); // stale value shown while refreshing
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('a failed fetch is retried on the next get', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(120);
    const c = new SeatTodayCache(fetch, () => 0);
    c.get('A1');
    await Promise.resolve();
    await Promise.resolve();
    c.get('A1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('seatTodayText', () => {
    expect(seatTodayText(3900)).toBe('오늘 이 자리에서 1시간 5분 공부했어요');
  });
});

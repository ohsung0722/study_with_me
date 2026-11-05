import { describe, expect, test } from 'vitest';
import { kstDayKey } from '@studyverse/shared';
import { devHourFromSearch, liveTodaySec } from '../src/game/clock';

describe('devHourFromSearch', () => {
  test('reads ?hour=21', () => expect(devHourFromSearch('?hour=21')).toBe(21));
  test('works among other params and accepts 0', () => expect(devHourFromSearch('?a=1&hour=0')).toBe(0));
  test('absent or invalid -> null', () => {
    for (const s of ['', '?hour=', '?hour=24', '?hour=-1', '?hour=7.5', '?hour=abc', '?h=3']) {
      expect(devHourFromSearch(s), s).toBeNull();
    }
  });
});

describe('liveTodaySec', () => {
  // 2026-11-05 12:00 KST = 03:00 UTC
  const noon = Date.UTC(2026, 10, 5, 3, 0, 0);
  const day = kstDayKey(noon);
  test('not studying -> stored seconds', () => {
    expect(liveTodaySec({ sec: 120, day }, { kind: 'none' }, noon)).toBe(120);
    expect(liveTodaySec({ sec: 120, day }, { kind: 'break', endsAt: noon + 1 }, noon)).toBe(120);
  });
  test('studying adds the live session (floored seconds)', () => {
    const st = { kind: 'studying' as const, startedAt: noon - 90_500, focus: true };
    expect(liveTodaySec({ sec: 100, day }, st, noon)).toBe(190);
  });
  test('after KST midnight: the stored total belongs to yesterday and only today\'s part of the session counts', () => {
    const midnight = Date.UTC(2026, 10, 5, 15, 0, 0); // 2026-11-06 00:00 KST
    const st = { kind: 'studying' as const, startedAt: midnight - 600_000, focus: false };
    expect(liveTodaySec({ sec: 5000, day }, st, midnight + 60_000)).toBe(60);
    expect(liveTodaySec({ sec: 5000, day }, { kind: 'none' }, midnight + 1)).toBe(0);
  });
});

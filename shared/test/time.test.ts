import { expect, test } from 'vitest';
import { kstDayKey, splitAtKstMidnight, isNightHour, formatHMS, formatMS } from '../src/index';

test('kstDayKey uses UTC+9', () => {
  expect(kstDayKey(Date.UTC(2026, 10, 4, 14, 59, 59))).toBe('2026-11-04'); // KST 23:59:59
  expect(kstDayKey(Date.UTC(2026, 10, 4, 15, 0, 0))).toBe('2026-11-05');   // KST 00:00
});
test('splitAtKstMidnight splits a 23:50→00:10 KST session into two 600s parts', () => {
  const s = Date.UTC(2026, 10, 4, 14, 50), e = Date.UTC(2026, 10, 4, 15, 10);
  const parts = splitAtKstMidnight(s, e);
  expect(parts.map(p => p.dayKey)).toEqual(['2026-11-04', '2026-11-05']);
  expect(parts.map(p => (p.endMs - p.startMs) / 1000)).toEqual([600, 600]);
});
test('splitAtKstMidnight keeps same-day sessions whole and drops empty ones', () => {
  expect(splitAtKstMidnight(1000, 5000)).toHaveLength(1);
  expect(splitAtKstMidnight(5000, 5000)).toEqual([]);
});
test('isNightHour', () => {
  expect([6, 19, 23, 0].map(isNightHour)).toEqual([true, true, true, true]);
  expect([7, 12, 18].map(isNightHour)).toEqual([false, false, false]);
});
test('formatters', () => {
  expect(formatHMS(3753)).toBe('01:02:33');
  expect(formatMS(312)).toBe('05:12');
  expect(formatMS(-4)).toBe('00:00');
});

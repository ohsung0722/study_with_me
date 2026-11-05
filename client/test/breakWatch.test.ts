import { describe, expect, test } from 'vitest';
import { breakEndCheck, breakLeftSec } from '../src/ui/breakWatch';

describe('breakEndCheck', () => {
  const brk = { kind: 'break', endsAt: 10_000 } as const;

  test('alerts exactly once when endsAt passes', () => {
    expect(breakEndCheck(brk, 9_999, null)).toEqual({ alert: false, alertedFor: null });
    const first = breakEndCheck(brk, 10_000, null);
    expect(first).toEqual({ alert: true, alertedFor: 10_000 });
    expect(breakEndCheck(brk, 12_000, first.alertedFor)).toEqual({ alert: false, alertedFor: 10_000 });
  });

  test('a new break (new endsAt, e.g. after changing minutes) alerts again', () => {
    expect(breakEndCheck({ kind: 'break', endsAt: 20_000 }, 20_500, 10_000)).toEqual({ alert: true, alertedFor: 20_000 });
  });

  test('not on break → never alerts, memo kept', () => {
    expect(breakEndCheck({ kind: 'none' }, 99_999, 10_000)).toEqual({ alert: false, alertedFor: 10_000 });
    expect(breakEndCheck({ kind: 'studying', startedAt: 0, focus: false }, 99_999, null)).toEqual({ alert: false, alertedFor: null });
  });

  test('breakLeftSec counts down, clamps at 0, null when not on break', () => {
    expect(breakLeftSec(brk, 5_000)).toBe(5);
    expect(breakLeftSec(brk, 50_000)).toBe(0);
    expect(breakLeftSec({ kind: 'none' }, 0)).toBeNull();
  });
});

import { describe, expect, test } from 'vitest';
import { kstDayKey, type PlayerView } from '@studyverse/shared';
import { maskBeforeStand, standLocally } from '../src/game/selfState';
import { liveTodaySec } from '../src/game/clock';

const now = Date.UTC(2026, 10, 5, 3, 0, 0); // 12:00 KST
const day = kstDayKey(now);
const seated = (status: PlayerView['status']): PlayerView => ({
  id: 'me', nickname: '나', appearance: { hair: 'short', hairColor: '#000000', shirtColor: '#ffffff' }, isNpc: false,
  x: 18.8, z: 8.85, ry: Math.PI, zone: 'reading', seatId: 'R13', status, drink: null,
});

describe('standLocally', () => {
  test('clears the seat and the studying status (no focus HUD/vignette/🔒 while walking off)', () => {
    const r = standLocally(seated({ kind: 'studying', startedAt: now - 60_000, focus: true }), { sec: 100, day }, now);
    expect(r.view.seatId).toBeNull();
    expect(r.view.status).toEqual({ kind: 'none' });
  });
  test('folds the ended session into my today total once: no drop, no double count', () => {
    const view = seated({ kind: 'studying', startedAt: now - 60_000, focus: true });
    const before = liveTodaySec({ sec: 100, day }, view.status, now);
    const r = standLocally(view, { sec: 100, day }, now);
    expect(r.today).toEqual({ sec: 160, day });
    expect(liveTodaySec(r.today, r.view.status, now)).toBe(before);
  });
  test('sofa (not studying): status and total untouched', () => {
    const view = { ...seated({ kind: 'break', endsAt: now + 1000 }), seatId: 'S1' };
    const r = standLocally(view, { sec: 100, day }, now);
    expect(r.view.status).toEqual({ kind: 'break', endsAt: now + 1000 });
    expect(r.today).toEqual({ sec: 100, day });
  });
});

describe('maskBeforeStand', () => {
  test('an update sent before the server handled my stand keeps me standing and not studying', () => {
    const v = maskBeforeStand(seated({ kind: 'studying', startedAt: now, focus: true }));
    expect(v.seatId).toBeNull();
    expect(v.status).toEqual({ kind: 'none' });
  });
  test('other statuses pass through', () => {
    expect(maskBeforeStand(seated({ kind: 'break', endsAt: 5 })).status).toEqual({ kind: 'break', endsAt: 5 });
  });
});

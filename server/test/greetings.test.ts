import { describe, expect, test } from 'vitest';
import type { PlayerView } from '@studyverse/shared';
import { pickGreetTarget } from '../src/game/greetings';

const view = (id: string, x: number, z: number, over: Partial<PlayerView> = {}): PlayerView => ({
  id, nickname: id, appearance: { hair: 'short', hairColor: '#000000', shirtColor: '#3366ff' }, isNpc: false,
  x, z, ry: 0, zone: 'lounge', seatId: null, status: { kind: 'none' }, drink: null, ...over,
});
const focusing = { kind: 'studying', startedAt: 0, focus: true } as const;
const sender = (over: Partial<PlayerView> & { lastGreetAt?: number } = {}) => ({ ...view('s', 5, 5, over), lastGreetAt: -Infinity, ...over });

describe('pickGreetTarget', () => {
  test('picks nearest eligible within 2m', () => {
    const r = pickGreetTarget(sender(), [view('far', 6.9, 5), view('near', 5.5, 5), view('out', 8, 5)], 1000);
    expect(r).toEqual({ ok: true, targetId: 'near' });
  });
  test('focus target is skipped; only focus targets nearby → noTarget', () => {
    expect(pickGreetTarget(sender(), [view('f', 5.5, 5, { status: focusing })], 1000)).toEqual({ ok: false, reason: 'noTarget' });
    expect(pickGreetTarget(sender(), [view('f', 5.5, 5, { status: focusing }), view('g', 6.5, 5)], 1000)).toEqual({ ok: true, targetId: 'g' });
  });
  test('sender in focus → focus', () => {
    expect(pickGreetTarget(sender({ status: focusing }), [view('a', 5.5, 5)], 1000)).toEqual({ ok: false, reason: 'focus' });
  });
  test('second greet within 5s → cooldown; at 5000ms → ok', () => {
    const o = [view('a', 5.5, 5)];
    expect(pickGreetTarget(sender({ lastGreetAt: 1000 }), o, 5999)).toEqual({ ok: false, reason: 'cooldown' });
    expect(pickGreetTarget(sender({ lastGreetAt: 1000 }), o, 6000)).toEqual({ ok: true, targetId: 'a' });
  });
  test('npc is never a target', () => {
    expect(pickGreetTarget(sender(), [view('n', 5.5, 5, { isNpc: true })], 1000)).toEqual({ ok: false, reason: 'noTarget' });
  });
  test('target in another zone (through a wall) is not eligible; self is ignored', () => {
    // lounge x<13, corridor beyond; 12.5 vs 13.5 are 1m apart
    const s = sender({ x: 12.5, z: 5 });
    expect(pickGreetTarget(s, [view('c', 13.5, 5, { zone: 'corridor' }), view('s', 12.5, 5)], 1000)).toEqual({ ok: false, reason: 'noTarget' });
  });
});

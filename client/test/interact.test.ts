import { describe, expect, test } from 'vitest';
import { seatById, type PlayerView, type Status } from '@studyverse/shared';
import { pickPrompt } from '../src/game/interact';

let n = 0;
const pv = (x: number, z: number, extra: Partial<PlayerView> = {}): PlayerView => ({
  id: `p${++n}`, nickname: '민수', appearance: { hair: 'short', hairColor: '#111111', shirtColor: '#222222' },
  isNpc: false, x, z, ry: 0, zone: null, seatId: null, status: { kind: 'none' }, drink: null, ...extra,
});
const focus: Status = { kind: 'studying', startedAt: 0, focus: true };
const R01 = seatById('R01')!; // reading desk seat at (18.6, 2.65)

describe('pickPrompt', () => {
  test('pickPrompt: near free desk → sit; seated → stand', () => {
    const me = pv(18.6, 3.6);
    expect(pickPrompt(me, [], null)).toEqual({ kind: 'sit', seatId: 'R01', text: 'E 앉기' });
    // occupied by someone else → no sit prompt (the focused occupant next to me blocks greeting instead)
    expect(pickPrompt(me, [pv(R01.x, R01.z, { seatId: 'R01', status: focus })], null)).toEqual({ kind: 'focusBlocked', text: '🔒 집중 중' });
    // occupant out of greet range (moved away, seat still held) → nothing
    expect(pickPrompt(me, [pv(30, 11, { seatId: 'R01' })], null)).toBeNull();
    const seated = pv(R01.x, R01.z, { seatId: 'R01', status: focus });
    expect(pickPrompt(seated, [pv(18.6, 3.6)], null)).toEqual({ kind: 'stand', text: 'E 일어나기' });
  });

  test('pickPrompt: free seat within INTERACT_RANGE but in another zone → no sit prompt', () => {
    // R06 sits 1.4 m from the reading room's outer wall (x=32). Just past it (zone null) is within range
    // by distance, but the server rejects sitting across zones, so no prompt.
    const R06 = seatById('R06')!;
    const outside = pv(32, R06.z);
    expect(Math.hypot(outside.x - R06.x, outside.z - R06.z)).toBeLessThanOrEqual(1.5);
    expect(pickPrompt(outside, [], null)).toBeNull();
    expect(pickPrompt(pv(31.9, R06.z), [], null)).toEqual({ kind: 'sit', seatId: 'R06', text: 'E 앉기' }); // same zone → sit
  });

  test('pickPrompt: near focused player → focusBlocked; near normal player → greet', () => {
    const me = pv(3, 18);
    const normal = pv(4, 18);
    const focused = pv(4, 18.5, { status: focus });
    expect(pickPrompt(me, [focused], null)).toEqual({ kind: 'focusBlocked', text: '🔒 집중 중' });
    expect(pickPrompt(me, [normal], null)).toEqual({ kind: 'greet', targetId: normal.id, text: 'E 인사하기' });
    // like the server: the nearest *eligible* player is greeted even if a focused one is closer
    const closerFocused = pv(3.5, 18, { status: focus });
    expect(pickPrompt(me, [closerFocused, normal], null)).toEqual({ kind: 'greet', targetId: normal.id, text: 'E 인사하기' });
    // out of range
    expect(pickPrompt(me, [pv(5.5, 18)], null)).toBeNull();
  });

  test('pickPrompt: NPCs, myself and players in another zone are never greet targets', () => {
    const me = pv(3, 18);
    expect(pickPrompt(me, [pv(4, 18, { isNpc: true }), { ...me }], null)).toBeNull();
    const inCorridor = pv(14.5, 5);
    const inReading = pv(16.4, 5); // 1.9 m away, but through the corridor/reading wall
    expect(pickPrompt(inCorridor, [inReading], null)).toBeNull();
    expect(pickPrompt(inCorridor, [inReading, pv(14.5, 6)], null)?.kind).toBe('greet');
  });

  test('pickPrompt: I am focused → no greet prompt', () => {
    const me = pv(3, 18, { status: focus });
    expect(pickPrompt(me, [pv(4, 18)], null)).toBeNull();
    expect(pickPrompt(me, [pv(4, 18, { status: focus })], null)).toBeNull();
  });

  test('pickPrompt: pending greet → acceptGreet takes priority over sit/greet', () => {
    const accept = { kind: 'acceptGreet', fromId: 'g1', text: 'E 인사 받기' };
    expect(pickPrompt(pv(18.6, 3.6), [], 'g1')).toEqual(accept); // over sit
    expect(pickPrompt(pv(3, 18), [pv(4, 18)], 'g1')).toEqual(accept); // over greet
    expect(pickPrompt(pv(1.9, 3), [], 'g1')).toEqual(accept); // over machine
    // seated on a sofa (not focus) → accept beats stand; seated in focus → stand
    const sofa = seatById('S1')!;
    expect(pickPrompt(pv(sofa.x, sofa.z, { seatId: 'S1' }), [], 'g1')).toEqual(accept);
    expect(pickPrompt(pv(R01.x, R01.z, { seatId: 'R01', status: focus }), [], 'g1')).toEqual({ kind: 'stand', text: 'E 일어나기' });
  });

  test('pickPrompt: lounge fixtures within range beat seats and people', () => {
    expect(pickPrompt(pv(1.9, 3), [], null)).toEqual({ kind: 'machine', id: 'coffee', text: 'E 음료 고르기' });
    expect(pickPrompt(pv(1.9, 6), [pv(2.5, 6)], null)).toEqual({ kind: 'machine', id: 'vending', text: 'E 음료 고르기' });
    expect(pickPrompt(pv(6.5, 21.5), [], null)).toEqual({ kind: 'radio', text: 'E 배경음 바꾸기' });
    expect(pickPrompt(pv(6.5, 1.2), [], null)).toEqual({ kind: 'board', text: 'E 기록판 보기' });
  });
});

describe('pickPrompt allocations', () => {
  test('prompts without dynamic fields are shared constants (no per-frame object)', () => {
    const seated = pv(R01.x, R01.z, { seatId: 'R01' });
    const a = pickPrompt(seated, [], null), b = pickPrompt(seated, [], null);
    expect(a).toEqual({ kind: 'stand', text: 'E 일어나기' });
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    const nearRadio = pv(6.5, 22.2);
    expect(pickPrompt(nearRadio, [], null)).toBe(pickPrompt(nearRadio, [], null));
  });
});

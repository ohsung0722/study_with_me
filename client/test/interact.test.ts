import { describe, expect, test } from 'vitest';
import { seatById, type PlayerView, type Status } from '@studyverse/shared';
import { pickPrompt } from '../src/game/interact';

let n = 0;
const pv = (x: number, z: number, extra: Partial<PlayerView> = {}): PlayerView => ({
  id: `p${++n}`, nickname: '민수', appearance: { hair: 'short', hairColor: '#111111', shirtColor: '#222222' },
  isNpc: false, x, z, ry: 0, zone: null, seatId: null, status: { kind: 'none' }, drink: null, ...extra,
});
const focus: Status = { kind: 'studying', startedAt: 0, focus: true };
const R01 = seatById('R01')!; // reading desk seat at (17.2, 2.85)

describe('pickPrompt', () => {
  test('pickPrompt: near free desk → sit; seated → stand', () => {
    const me = pv(17.2, 3.8);
    expect(pickPrompt(me, [], null)).toEqual({ kind: 'sit', seatId: 'R01', text: 'E 앉기' });
    // occupied by someone else → no sit prompt (the focused occupant next to me blocks greeting instead)
    expect(pickPrompt(me, [pv(R01.x, R01.z, { seatId: 'R01', status: focus })], null)).toEqual({ kind: 'focusBlocked', text: '🔒 집중 중' });
    // occupant out of greet range (moved away, seat still held) → nothing
    expect(pickPrompt(me, [pv(30, 11, { seatId: 'R01' })], null)).toBeNull();
    const seated = pv(R01.x, R01.z, { seatId: 'R01', status: focus });
    expect(pickPrompt(seated, [pv(17.2, 3.8)], null)).toEqual({ kind: 'stand', text: 'E 일어나기' });
  });

  test('pickPrompt: study-room seat seen from the other side of its wall → no sit prompt', () => {
    // A1 sits 2.45 m from the reading|studyA wall (z=14). Just past it (zone reading, no reading seat in range)
    // there is no prompt: the chair is in another zone (the server rejects sitting across zones) and out of range.
    const A1 = seatById('A1')!;
    expect(pickPrompt(pv(A1.x, 13.99), [], null)).toBeNull();
    expect(pickPrompt(pv(A1.x, 15.2), [], null)).toEqual({ kind: 'sit', seatId: 'A1', text: 'E 앉기' }); // same zone → sit
  });

  test('pickPrompt: near focused player → focusBlocked; near normal player → greet', () => {
    const me = pv(3, 22.5);
    const normal = pv(4, 22.5);
    const focused = pv(4, 23, { status: focus });
    expect(pickPrompt(me, [focused], null)).toEqual({ kind: 'focusBlocked', text: '🔒 집중 중' });
    expect(pickPrompt(me, [normal], null)).toEqual({ kind: 'greet', targetId: normal.id, text: 'E 인사하기' });
    // like the server: the nearest *eligible* player is greeted even if a focused one is closer
    const closerFocused = pv(3.5, 22.5, { status: focus });
    expect(pickPrompt(me, [closerFocused, normal], null)).toEqual({ kind: 'greet', targetId: normal.id, text: 'E 인사하기' });
    // out of range
    expect(pickPrompt(me, [pv(5.5, 22.5)], null)).toBeNull();
  });

  test('pickPrompt: NPCs, myself and players in another zone are never greet targets', () => {
    const me = pv(3, 22.5);
    expect(pickPrompt(me, [pv(4, 22.5, { isNpc: true }), { ...me }], null)).toBeNull();
    const inCorridor = pv(21.5, 5);
    const inReading = pv(19.6, 5); // 1.9 m away, but through the corridor/reading wall
    expect(pickPrompt(inCorridor, [inReading], null)).toBeNull();
    expect(pickPrompt(inCorridor, [inReading, pv(21.5, 6)], null)?.kind).toBe('greet');
  });

  test('pickPrompt: I am focused → no greet prompt', () => {
    const me = pv(3, 22.5, { status: focus });
    expect(pickPrompt(me, [pv(4, 22.5)], null)).toBeNull();
    expect(pickPrompt(me, [pv(4, 22.5, { status: focus })], null)).toBeNull();
  });

  test('pickPrompt: pending greet → acceptGreet takes priority over sit/greet', () => {
    const accept = { kind: 'acceptGreet', fromId: 'g1', text: 'E 인사 받기' };
    expect(pickPrompt(pv(17.2, 3.8), [], 'g1')).toEqual(accept); // over sit
    expect(pickPrompt(pv(3, 22.5), [pv(4, 22.5)], 'g1')).toEqual(accept); // over greet
    expect(pickPrompt(pv(27.1, 26.9), [], 'g1')).toEqual(accept); // over machine
    // seated on a sofa (not focus) → accept beats stand; seated in focus → stand
    const sofa = seatById('S1')!;
    expect(pickPrompt(pv(sofa.x, sofa.z, { seatId: 'S1' }), [], 'g1')).toEqual(accept);
    expect(pickPrompt(pv(R01.x, R01.z, { seatId: 'R01', status: focus }), [], 'g1')).toEqual({ kind: 'stand', text: 'E 일어나기' });
  });

  test('pickPrompt: lounge fixtures within range beat seats and people', () => {
    expect(pickPrompt(pv(27.1, 26.9), [], null)).toEqual({ kind: 'machine', id: 'coffee', text: 'E 음료 고르기' });
    expect(pickPrompt(pv(27.1, 35), [pv(27.7, 35)], null)).toEqual({ kind: 'machine', id: 'vending', text: 'E 음료 고르기' });
    expect(pickPrompt(pv(17.5, 34.6), [], null)).toEqual({ kind: 'radio', text: 'E 배경음 바꾸기' });
    expect(pickPrompt(pv(3.5, 26.2), [], null)).toEqual({ kind: 'board', text: 'E 기록판 보기' });
  });
});

describe('pickPrompt allocations', () => {
  test('prompts without dynamic fields are shared constants (no per-frame object)', () => {
    const seated = pv(R01.x, R01.z, { seatId: 'R01' });
    const a = pickPrompt(seated, [], null), b = pickPrompt(seated, [], null);
    expect(a).toEqual({ kind: 'stand', text: 'E 일어나기' });
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    const nearRadio = pv(17.5, 34.9);
    expect(pickPrompt(nearRadio, [], null)).toBe(pickPrompt(nearRadio, [], null));
  });
});

import { describe, expect, test } from 'vitest';
import { MAP, seatById } from '@studyverse/shared';
import { LIT_ROOMS, ROOM_LIGHT_FADE_MS, ROOM_LIGHT_OFF_DELAY_MS, RoomLights, stepRoomLight } from '../src/game/roomLights';

const IN_A = { x: 2, z: 16.5 }, IN_B = { x: 12, z: 16.5 }, CORRIDOR = { x: 21.5, z: 16.5 }, READING = { x: 6, z: 6 };

/** Run `ms` of 16 ms frames, marking `who` every frame. */
function run(r: RoomLights, who: { x: number; z: number }[], ms: number, step = 16) {
  for (let t = 0; t < ms; t += step) {
    for (const p of who) r.mark(p.x, p.z);
    r.update(step);
  }
}

describe('stepRoomLight (one room)', () => {
  test('occupied: fades on linearly over ROOM_LIGHT_FADE_MS', () => {
    let s = { level: 0, emptyMs: 0 };
    s = stepRoomLight(s, true, ROOM_LIGHT_FADE_MS / 2);
    expect(s.level).toBeCloseTo(0.5, 9);
    s = stepRoomLight(s, true, ROOM_LIGHT_FADE_MS);
    expect(s.level).toBe(1);
    expect(s.emptyMs).toBe(0);
  });
  test('empty: holds for ROOM_LIGHT_OFF_DELAY_MS, then fades off over ROOM_LIGHT_FADE_MS', () => {
    let s = { level: 1, emptyMs: 0 };
    s = stepRoomLight(s, false, ROOM_LIGHT_OFF_DELAY_MS - 1);
    expect(s.level).toBe(1);
    s = stepRoomLight(s, false, 1 + ROOM_LIGHT_FADE_MS / 4); // the part past the delay already fades
    expect(s.level).toBeCloseTo(0.75, 9);
    s = stepRoomLight(s, false, ROOM_LIGHT_FADE_MS);
    expect(s.level).toBe(0);
  });
  test('someone coming back during the delay cancels it', () => {
    let s = { level: 1, emptyMs: 0 };
    s = stepRoomLight(s, false, 2500);
    s = stepRoomLight(s, true, 16);
    expect(s).toEqual({ level: 1, emptyMs: 0 });
    s = stepRoomLight(s, false, 2500);
    expect(s.level).toBe(1); // the delay starts over
  });
  test('reversing mid-fade continues from the current level (no pop)', () => {
    let s = { level: 1, emptyMs: 0 };
    s = stepRoomLight(s, false, ROOM_LIGHT_OFF_DELAY_MS + ROOM_LIGHT_FADE_MS / 2);
    expect(s.level).toBeCloseTo(0.5, 9);
    s = stepRoomLight(s, true, ROOM_LIGHT_FADE_MS / 4);
    expect(s.level).toBeCloseTo(0.75, 9);
  });
  test('negative / zero dt changes nothing', () => {
    expect(stepRoomLight({ level: 0.3, emptyMs: 100 }, false, -50)).toEqual({ level: 0.3, emptyMs: 100 });
    expect(stepRoomLight({ level: 0.3, emptyMs: 0 }, true, 0)).toEqual({ level: 0.3, emptyMs: 0 });
  });
});

describe('RoomLights (players → per-room level)', () => {
  test('the lit rooms are the two lounges and the four study rooms; every other zone reads 0', () => {
    expect([...LIT_ROOMS].sort()).toEqual(['cafe', 'lounge', 'studyA', 'studyB', 'studyC', 'studyD']);
    const r = new RoomLights();
    run(r, [CORRIDOR, READING, { x: 5, z: 22.5 }], 2000); // the west hall too
    for (const z of Object.keys(MAP.zones) as (keyof typeof MAP.zones)[]) expect(r.level(z), z).toBe(0);
    run(r, [{ x: 6, z: 30 }], 2000);
    expect(r.level('lounge')).toBe(1);
    expect(r.level('cafe')).toBe(0);
  });
  test('starts off; anyone inside (me, a player, an NPC seat) turns that room on within ~0.4 s', () => {
    const r = new RoomLights();
    expect(r.level('studyA')).toBe(0);
    run(r, [IN_A], 200);
    expect(r.level('studyA')).toBeGreaterThan(0.3);
    expect(r.level('studyA')).toBeLessThan(0.7);
    run(r, [IN_A], 250);
    expect(r.level('studyA')).toBe(1);
    // a seated NPC is marked at its seat position
    const b = seatById('B5')!;
    run(r, [b], 500);
    expect(r.level('studyB')).toBe(1);
  });
  test('off ~3 s after the room empties, fully dark ~0.4 s later', () => {
    const r = new RoomLights();
    run(r, [IN_A], 600);
    run(r, [CORRIDOR], ROOM_LIGHT_OFF_DELAY_MS - 100);
    expect(r.level('studyA')).toBe(1);
    run(r, [CORRIDOR], 100 + ROOM_LIGHT_FADE_MS / 2);
    expect(r.level('studyA')).toBeGreaterThan(0.3);
    expect(r.level('studyA')).toBeLessThan(0.7);
    run(r, [CORRIDOR], ROOM_LIGHT_FADE_MS / 2 + 50);
    expect(r.level('studyA')).toBe(0);
  });
  test('rooms are independent', () => {
    const r = new RoomLights();
    run(r, [IN_A, IN_B], 600);
    expect(r.level('studyA')).toBe(1);
    expect(r.level('studyB')).toBe(1);
    run(r, [IN_B], 5000); // A empties, B stays occupied
    expect(r.level('studyA')).toBe(0);
    expect(r.level('studyB')).toBe(1);
    run(r, [IN_A], 600);  // and the other way round
    expect(r.level('studyA')).toBe(1);
    expect(r.level('studyB')).toBe(1); // still within B's off delay
  });
  test('marks only count for the update they precede', () => {
    const r = new RoomLights();
    r.mark(IN_A.x, IN_A.z);
    r.update(ROOM_LIGHT_FADE_MS);
    expect(r.level('studyA')).toBe(1);
    r.update(ROOM_LIGHT_OFF_DELAY_MS + ROOM_LIGHT_FADE_MS); // nobody marked since: off
    expect(r.level('studyA')).toBe(0);
  });
  test('positions outside the building (or not a number) are ignored', () => {
    const r = new RoomLights();
    run(r, [{ x: -3, z: 16 }, { x: 40, z: 21 }, { x: NaN, z: 16 }], 600);
    expect(r.level('studyA')).toBe(0);
    expect(r.level('studyB')).toBe(0);
  });
});

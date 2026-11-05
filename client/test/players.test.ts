import { describe, expect, test } from 'vitest';
import { WALK_SPEED, isBlocked, seatById } from '@studyverse/shared';
import {
  NPC_FADE_MS, NPC_STAND_MS, NPC_WALK_MS, WALK_HOLD_MS, npcExitPath, npcLeaveState, pointAlong, remotePose,
} from '../src/game/players';

describe('remotePose', () => {
  test('seated players sit regardless of movement', () => {
    expect(remotePose(true, 0.5, 16, 0).pose).toBe('sit');
  });
  test('moving -> walk and the hold timer is refilled', () => {
    expect(remotePose(false, 0.05, 16, 0)).toEqual({ pose: 'walk', holdMs: WALK_HOLD_MS });
  });
  test('a short pause between snapshots keeps walking until the hold runs out, then stands', () => {
    const a = remotePose(false, 0, 100, WALK_HOLD_MS);
    expect(a.pose).toBe('walk');
    const b = remotePose(false, 0, 100, a.holdMs);
    expect(b).toEqual({ pose: 'stand', holdMs: 0 });
  });
  test('no movement and no hold -> stand', () => {
    expect(remotePose(false, 0, 16, 0)).toEqual({ pose: 'stand', holdMs: 0 });
  });
});

describe('npcExitPath / pointAlong', () => {
  test('starts at the seat, steps back from the desk, ends at the reading-room door', () => {
    const seat = seatById('R24')!;
    const path = npcExitPath(seat);
    expect(path[0]).toEqual({ x: seat.x, z: seat.z });
    expect(path[1].z).toBeGreaterThan(seat.z); // desk is at -z (seat faces PI): back away to +z
    const end = path[path.length - 1];
    expect(end.x).toBeCloseTo(16, 5);
    expect(end.z).toBeGreaterThanOrEqual(9);
    expect(end.z).toBeLessThanOrEqual(11);
  });
  test('the path never passes through desks or walls (sampled every 5 cm) for every NPC seat', () => {
    for (const id of ['R24', 'R19', 'R14', 'R01', 'R06']) {
      const path = npcExitPath(seatById(id)!);
      let len = 0;
      for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
      for (let d = 0.3; d <= len; d += 0.05) {
        const p = pointAlong(path, d);
        expect(isBlocked(p.x, p.z, 0.2), `${id} at ${d.toFixed(2)}m (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBe(false);
      }
    }
  });
  test('pointAlong interpolates along segments, faces the segment direction, clamps at the end', () => {
    const path = [{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: -3, z: 2 }];
    expect(pointAlong(path, 1)).toEqual({ x: 0, z: 1, ry: 0 });         // +z -> ry 0
    const p = pointAlong(path, 3);
    expect(p.x).toBeCloseTo(-1);
    expect(p.z).toBeCloseTo(2);
    expect(p.ry).toBeCloseTo(-Math.PI / 2);                                // -x -> ry -PI/2
    const end = pointAlong(path, 99);
    expect(end.x).toBeCloseTo(-3);
    expect(end.z).toBeCloseTo(2);
    expect(pointAlong(path, -1)).toEqual({ x: 0, z: 0, ry: 0 });
  });
});

describe('npcLeaveState', () => {
  test('stands up first, then walks at WALK_SPEED for NPC_WALK_MS, fading out at the end, then done', () => {
    expect(npcLeaveState(0)).toEqual({ walking: false, distM: 0, opacity: 1, done: false });
    expect(npcLeaveState(NPC_STAND_MS - 1).walking).toBe(false);
    const mid = npcLeaveState(NPC_STAND_MS + 1000);
    expect(mid.walking).toBe(true);
    expect(mid.distM).toBeCloseTo(WALK_SPEED * 1);
    expect(mid.opacity).toBe(1);
    const fading = npcLeaveState(NPC_STAND_MS + NPC_WALK_MS - NPC_FADE_MS / 2);
    expect(fading.opacity).toBeCloseTo(0.5);
    const end = npcLeaveState(NPC_STAND_MS + NPC_WALK_MS);
    expect(end.done).toBe(true);
    expect(end.opacity).toBe(0);
  });
  test('walking lasts exactly 2 s', () => {
    expect(NPC_WALK_MS).toBe(2000);
  });
});

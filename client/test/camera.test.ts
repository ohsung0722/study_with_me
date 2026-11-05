import { describe, expect, test } from 'vitest';
import { MAP, zoneAt, type Rect } from '@studyverse/shared';
import { seatedCameraPose, followYaw, forwardWeight, approachDist, FOLLOW_TAU_MS } from '../src/game/camera';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe('followYaw (camera eases behind the character)', () => {
  test('weight 0 leaves the yaw alone', () => {
    expect(followYaw(0.3, 1.2, 0, 16)).toBe(0.3);
  });
  test('converges to behind the facing (facing + π)', () => {
    let yaw = 0;
    for (let i = 0; i < 300; i++) yaw = followYaw(yaw, 1, 1, 16);
    expect(wrap(yaw - (1 + Math.PI))).toBeCloseTo(0, 3);
  });
  test('covers ~63 % of the gap after one time constant', () => {
    const yaw = followYaw(0, Math.PI / 2 - Math.PI, 1, FOLLOW_TAU_MS); // target yaw = π/2
    expect(yaw / (Math.PI / 2)).toBeCloseTo(1 - Math.exp(-1), 3);
  });
  test('takes the shortest arc across ±π', () => {
    const yaw = followYaw(3.0, -2.9 - Math.PI, 1, 16); // target -2.9: 0.38 rad away across the seam
    expect(yaw).toBeGreaterThan(3.0);
  });
  test('is frame-rate independent', () => {
    let a = 0, b = 0;
    for (let i = 0; i < 10; i++) a = followYaw(a, 1, 1, 10);
    b = followYaw(b, 1, 1, 100);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('approachDist (wall pull-in snaps in fast, eases back out slowly)', () => {
  test('moving in toward a wall is fast', () => {
    expect(approachDist(5, 1, 50)).toBeLessThan(2.6); // > ~60 % of the way in 50 ms
  });
  test('moving back out is slow', () => {
    const d = approachDist(1, 5, 50);
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(1.6);
  });
  test('settles on the target', () => {
    let d = 1;
    for (let i = 0; i < 300; i++) d = approachDist(d, 5, 16); // ~4.8 s = 12 time constants
    expect(d).toBeCloseTo(5, 3);
  });
});

describe('forwardWeight (only forward motion turns the camera)', () => {
  test('W = 1, S = 0, A/D = 0', () => {
    expect(forwardWeight({ x: 0, z: 1 })).toBe(1);
    expect(forwardWeight({ x: 0, z: -1 })).toBe(0);
    expect(forwardWeight({ x: 1, z: 0 })).toBe(0);
    expect(forwardWeight({ x: 0, z: 0 })).toBe(0);
  });
  test('diagonals turn the camera gently', () => {
    const w = forwardWeight({ x: 1, z: 1 });
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(0.6);
  });
});

/** Distance from a point to a rect in the x/z plane (0 inside). */
const distToRect = (r: Rect, x: number, z: number) =>
  Math.hypot(x - Math.min(Math.max(x, r.x1), r.x2), z - Math.min(Math.max(z, r.z1), r.z2));

describe('seatedCameraPose', () => {
  test('covers all 80 seats', () => {
    expect(MAP.seats).toHaveLength(80);
  });

  test.each(MAP.seats.map((s) => [s.id, s] as const))('%s: camera stays in its own zone, clear of walls, with no wall in between', (_id, seat) => {
    const { pos, look } = seatedCameraPose(seat);
    expect(zoneAt(pos.x, pos.z)).toBe(seat.zone);
    for (const w of MAP.walls) expect(distToRect(w, pos.x, pos.z)).toBeGreaterThan(0.1);
    // nothing between the seat and the camera
    for (let i = 0; i <= 20; i++) {
      const x = seat.x + ((pos.x - seat.x) * i) / 20, z = seat.z + ((pos.z - seat.z) * i) / 20;
      for (const w of MAP.walls) expect(distToRect(w, x, z)).toBeGreaterThan(0);
    }
    // still a behind-the-shoulder view: behind the seat (against its facing), above it, looking forward
    const fx = Math.sin(seat.facing), fz = Math.cos(seat.facing);
    const back = -((pos.x - seat.x) * fx + (pos.z - seat.z) * fz);
    expect(back).toBeGreaterThan(0.9);
    expect(pos.y).toBeGreaterThan(2);
    expect((look.x - seat.x) * fx + (look.z - seat.z) * fz).toBeGreaterThan(0);
  });
});

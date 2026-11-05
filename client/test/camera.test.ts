import { describe, expect, test } from 'vitest';
import { MAP, zoneAt, type Rect } from '@studyverse/shared';
import { seatedCameraPose } from '../src/game/camera';

/** Distance from a point to a rect in the x/z plane (0 inside). */
const distToRect = (r: Rect, x: number, z: number) =>
  Math.hypot(x - Math.min(Math.max(x, r.x1), r.x2), z - Math.min(Math.max(z, r.z1), r.z2));

describe('seatedCameraPose', () => {
  test('covers all 44 seats', () => {
    expect(MAP.seats).toHaveLength(44);
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

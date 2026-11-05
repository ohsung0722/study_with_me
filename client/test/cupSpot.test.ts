import { describe, expect, test } from 'vitest';
import { MAP, seatById } from '@studyverse/shared';
import { deskCupSpot } from '../src/three/cupSpot';

const toWorld = (seatId: string) => {
  const s = seatById(seatId)!;
  const spot = deskCupSpot(s.x, s.z, s.facing);
  if (!spot) return null;
  const c = Math.cos(s.facing), n = Math.sin(s.facing);
  return { x: s.x + spot.x * c + spot.z * n, z: s.z - spot.x * n + spot.z * c, local: spot };
};
const onDeskOrTable = (p: { x: number; z: number }) =>
  MAP.props.some(r => (r.kind === 'desk' || r.kind === 'table') && p.x > r.x1 && p.x < r.x2 && p.z > r.z1 && p.z < r.z2);

describe('deskCupSpot', () => {
  test('every desk and study-room chair gets a spot on its desk/table, in front of the avatar', () => {
    for (const seat of MAP.seats.filter(s => s.kind !== 'sofa')) {
      const w = toWorld(seat.id);
      expect(w, seat.id).not.toBeNull();
      expect(onDeskOrTable(w!), seat.id).toBe(true);
      expect(w!.local.z).toBeGreaterThan(0.45);
    }
  });

  test('prefers the avatar\'s right; end chairs fall back to the side over the table', () => {
    expect(toWorld('R01')!.local.x).toBe(-0.18);
    expect(toWorld('B1')!.local.x).toBe(0.18); // B1 sits at the table's end (x=22.5), right side would hang off
  });

  test('sofas have nothing in front → null (cup stays in hand)', () => {
    for (const id of ['S1', 'S4', 'S7', 'S8']) expect(toWorld(id), id).toBeNull();
  });
});

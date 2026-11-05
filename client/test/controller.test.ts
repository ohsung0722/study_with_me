import { describe, expect, test } from 'vitest';
import { WALK_SPEED } from '@studyverse/shared';
import { stepMovement, walkBlocked } from '../src/game/controller';

const free = () => false;

describe('stepMovement', () => {
  const run = (dir: { x: number; z: number }, yaw: number, ticks: number) => {
    let p = { x: 0, z: 0 }, last = { ry: 0 };
    for (let i = 0; i < ticks; i++) { const r = stepMovement(p, dir, yaw, 0.1, free); p = r; last = r; }
    return { ...p, ry: last.ry };
  };
  test('stepMovement: 1s forward moves 4m; diagonal still 4m', () => {
    const f = run({ x: 0, z: 1 }, 0, 10);
    expect(Math.hypot(f.x, f.z)).toBeCloseTo(WALK_SPEED);
    const d = run({ x: 1, z: 1 }, 0.7, 10);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(4);
  });

  test('W moves away from the camera and facing follows (sin ry, cos ry)', () => {
    const a = run({ x: 0, z: 1 }, 0, 5);
    expect(a.z).toBeCloseTo(-2); expect(a.x).toBeCloseTo(0);
    expect(Math.abs(a.ry)).toBeCloseTo(Math.PI);
    const b = run({ x: 0, z: 1 }, Math.PI / 2, 5);
    expect(b.x).toBeCloseTo(-2); expect(b.z).toBeCloseTo(0);
    expect(Math.sin(b.ry)).toBeCloseTo(-1);
    const r = run({ x: 1, z: 0 }, 0, 5);
    expect(r.x).toBeCloseTo(2);
  });

  test('no input -> not moving', () => {
    expect(stepMovement({ x: 3, z: 4 }, { x: 0, z: 0 }, 0, 0.1, free)).toMatchObject({ x: 3, z: 4, moving: false });
  });

  test('stepMovement slides along a wall instead of stopping', () => {
    const wall = (_x: number, z: number) => z < 0; // blocked beyond z=0
    const r = stepMovement({ x: 0, z: 0.01 }, { x: 1, z: 1 }, 0, 0.1, wall); // +x and -z
    expect(r.z).toBeCloseTo(0.01);
    expect(r.x).toBeGreaterThan(0.1);
    expect(r.moving).toBe(true);
  });

  test('fully blocked -> not moving', () => {
    const r = stepMovement({ x: 0, z: 0 }, { x: 0, z: 1 }, 0, 0.1, () => true);
    expect(r.moving).toBe(false);
  });
});

describe('walkBlocked', () => {
  test('step out through the entrance gap is blocked (outside building)', () => {
    expect(walkBlocked(14.5, 23)).toBe(false);
    expect(walkBlocked(14.5, 24.1)).toBe(true);
    const r = stepMovement({ x: 14.5, z: 23.9 }, { x: 0, z: -1 }, 0, 0.1, walkBlocked); // S at yaw 0 -> +z
    expect(r.z).toBeLessThan(24);
  });
  test('walls block', () => {
    expect(walkBlocked(13, 5)).toBe(true); // lounge|corridor wall
  });
});

test('stepMovement clamps dt to 0.1s', () => {
  const r = stepMovement({ x: 0, z: 0 }, { x: 0, z: 1 }, 0, 5, () => false);
  expect(Math.hypot(r.x, r.z)).toBeCloseTo(0.4);
});

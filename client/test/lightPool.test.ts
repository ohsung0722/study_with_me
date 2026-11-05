import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import {
  LIGHT_POOL_SIZE, POOL_FADE_MS, POOL_PICK_MS, LightPool, LightPoolState, assignSlots, lampScore, selectLamps,
  type LampSource,
} from '../src/three/lightPool';

const src = (x: number, z: number, intensity: number): LampSource => ({ x, y: 1, z, distance: 3, decay: 1.5, intensity });

/** A row of lamps along x (1 m apart), all at the same intensity. */
const row = (n: number, intensity = 2) => Array.from({ length: n }, (_, i) => src(i, 0, intensity));

/** Run the pool for `ms` in `step` ms frames. */
function run(pool: LightPoolState, sources: LampSource[], fx: number, fz: number, ms: number, step = 16) {
  for (let t = 0; t < ms; t += step) pool.update(sources, fx, fz, step);
}

describe('lampScore', () => {
  test('intensity / (1 + distance²) in the floor plane; 0 when off', () => {
    expect(lampScore(src(3, 4, 2), 0, 0)).toBeCloseTo(2 / 26);
    expect(lampScore(src(1, 1, 3), 1, 1)).toBe(3);
    expect(lampScore(src(0, 0, 0), 0, 0)).toBe(0);
  });
});

describe('selectLamps', () => {
  test('the n highest scores, best first', () => {
    const lamps = row(10);
    expect(selectLamps(lamps, 4.2, 0, 3)).toEqual([4, 5, 3]);
  });

  test('a brighter lamp further away can outrank a dim near one', () => {
    const lamps = [src(0, 0, 0.5), src(2, 0, 10)];
    expect(selectLamps(lamps, 0, 0, 1)).toEqual([1]); // 0.5/1 < 10/5
  });

  test('skips lamps that are off and returns fewer when not enough are lit', () => {
    const lamps = [src(0, 0, 0), src(1, 0, 2), src(2, 0, 0)];
    expect(selectLamps(lamps, 0, 0, 6)).toEqual([1]);
  });

  test('ties go to the lower index; reuses the out array', () => {
    const lamps = [src(-1, 0, 2), src(1, 0, 2), src(0, 1, 2)];
    const out = [99, 98, 97, 96];
    const r = selectLamps(lamps, 0, 0, 2, out);
    expect(r).toBe(out);
    expect(r).toEqual([0, 1]);
  });
});

describe('assignSlots', () => {
  const slot = (src: number, next: number, intensity: number) => ({ src, next, intensity });

  test('keeps slots on lamps that are still picked; frees the rest; fills free slots', () => {
    const slots = [slot(0, 0, 1), slot(1, 1, 1), slot(-1, -1, 0)];
    assignSlots(slots, [1, 2]);
    // lamp 1 stays in slot 1; lamp 2 takes a free slot; lamp 0 is no longer wanted anywhere
    expect(slots[1].next).toBe(1);
    expect(slots.filter((s) => s.next === 2)).toHaveLength(1);
    expect(slots.some((s) => s.next === 0)).toBe(false);
  });

  test('a lamp that comes back takes the slot still sitting on it (no jump)', () => {
    const slots = [slot(-1, -1, 0), slot(3, -1, 0.8)]; // slot 1 is fading out at lamp 3
    assignSlots(slots, [3]);
    expect(slots[1].next).toBe(3);
    expect(slots[0].next).toBe(-1);
  });

  test('prefers a dark free slot over one that is still fading out elsewhere', () => {
    const slots = [slot(5, -1, 0.9), slot(-1, -1, 0)];
    assignSlots(slots, [7]);
    expect(slots[1].next).toBe(7);
    expect(slots[0].next).toBe(-1);
  });
});

describe('LightPoolState', () => {
  test('never more than LIGHT_POOL_SIZE (6) slots, all lamps in range picked nearest first', () => {
    const pool = new LightPoolState();
    expect(LIGHT_POOL_SIZE).toBe(6);
    expect(pool.slots).toHaveLength(6);
    const lamps = row(24);
    run(pool, lamps, 10, 0, 1000);
    expect(pool.slots.map((s) => s.src).sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11, 12]); // 7 and 13 tie: lower index
    expect(pool.active()).toBe(6);
  });

  test('eases a newly lit slot up over ~250 ms instead of popping', () => {
    const pool = new LightPoolState(1);
    const lamps = [src(0, 0, 3)];
    pool.update(lamps, 0, 0, 16);
    expect(pool.slots[0].src).toBe(0);
    expect(pool.slots[0].intensity).toBeGreaterThan(0);
    expect(pool.slots[0].intensity).toBeLessThan(1.5);
    run(pool, lamps, 0, 0, POOL_FADE_MS);
    expect(pool.slots[0].intensity).toBeGreaterThan(3 * 0.9);
    run(pool, lamps, 0, 0, 1000);
    expect(pool.slots[0].intensity).toBeCloseTo(3, 3);
  });

  test('a slot moves to a new lamp only after fading out at the old one', () => {
    const pool = new LightPoolState(1);
    const lamps = [src(0, 0, 3), src(20, 0, 3)];
    run(pool, lamps, 0, 0, 1000);
    expect(pool.slots[0].src).toBe(0);
    let moved = false;
    for (let t = 0; t < 2000; t += 16) {
      const before = { ...pool.slots[0] };
      pool.update(lamps, 20, 0, 16);
      if (pool.slots[0].src !== before.src) {
        moved = true;
        expect(before.intensity).toBeLessThan(0.05); // dark when it jumps
        expect(pool.slots[0].src).toBe(1);
      }
    }
    expect(moved).toBe(true);
    expect(pool.slots[0].intensity).toBeCloseTo(3, 2);
  });

  test('re-picks only every ~150 ms', () => {
    const pool = new LightPoolState(1);
    const lamps = [src(0, 0, 3), src(20, 0, 3)];
    pool.update(lamps, 0, 0, 16);
    expect(pool.slots[0].next).toBe(0);
    pool.update(lamps, 20, 0, 16); // focus jumped, but the pick is not due yet
    expect(pool.slots[0].next).toBe(0);
    run(pool, lamps, 20, 0, POOL_PICK_MS);
    expect(pool.slots[0].next).toBe(1);
  });

  test('follows the lamp intensity (theme/zone dim) and goes dark when the lamp turns off', () => {
    const pool = new LightPoolState(1);
    const lamps = [src(0, 0, 3)];
    run(pool, lamps, 0, 0, 1000);
    lamps[0].intensity = 1;
    run(pool, lamps, 0, 0, 1000);
    expect(pool.slots[0].intensity).toBeCloseTo(1, 3);
    lamps[0].intensity = 0;
    run(pool, lamps, 0, 0, 1000);
    expect(pool.slots[0].intensity).toBe(0);
    expect(pool.active()).toBe(0);
  });

  test('share(): how much of a lamp the pool light carries (the fake glow takes the rest)', () => {
    const pool = new LightPoolState(1);
    const lamps = [src(0, 0, 3), src(9, 0, 3)];
    expect(pool.share(0, lamps)).toBe(0);
    pool.update(lamps, 0, 0, 16);
    const early = pool.share(0, lamps);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(1);
    run(pool, lamps, 0, 0, 1000);
    expect(pool.share(0, lamps)).toBeCloseTo(1, 3);
    expect(pool.share(1, lamps)).toBe(0);
  });
});

describe('LightPool (three.js binding)', () => {
  test('creates exactly 6 always-visible point lights and moves them to the picked lamps', () => {
    const parent = new THREE.Group();
    const pool = new LightPool(parent);
    const lights = parent.children.filter((o) => (o as THREE.PointLight).isPointLight) as THREE.PointLight[];
    expect(lights).toHaveLength(6);
    const lamps = [src(4, 2, 3)];
    lamps[0].y = 1.1;
    for (let t = 0; t < 1000; t += 16) pool.update(lamps, 4, 2, 16);
    const lit = lights.filter((l) => l.intensity > 0);
    expect(lit).toHaveLength(1);
    expect(lit[0].position.toArray()).toEqual([4, 1.1, 2]);
    expect(lit[0].distance).toBe(3);
    expect(lit[0].decay).toBe(1.5);
    lamps[0].intensity = 0;
    for (let t = 0; t < 1000; t += 16) pool.update(lamps, 4, 2, 16);
    expect(lights.every((l) => l.visible)).toBe(true);
    expect(lights.every((l) => l.intensity === 0)).toBe(true);
  });
});

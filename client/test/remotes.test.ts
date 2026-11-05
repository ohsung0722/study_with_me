import { describe, expect, test } from 'vitest';
import { Interpolator } from '../src/game/remotes';

describe('Interpolator', () => {
  const make = () => {
    const i = new Interpolator();
    i.push(1000, { x: 0, z: 0, ry: 0 });
    i.push(1100, { x: 10, z: 20, ry: 1 });
    return i;
  };
  test('empty -> null', () => expect(new Interpolator().sample(5)).toBeNull());
  test('Interpolator midpoint between snapshots; before first -> first; after last -> last', () => {
    const i = make();
    expect(i.sample(1150)).toEqual({ x: 5, z: 10, ry: 0.5 }); // render time 1050
    expect(i.sample(1000)).toEqual({ x: 0, z: 0, ry: 0 });    // before first
    expect(i.sample(5000)).toEqual({ x: 10, z: 20, ry: 1 });  // after last: hold
  });
  test('yaw takes the shortest arc across the +-PI seam', () => {
    const i = new Interpolator();
    i.push(0, { x: 0, z: 0, ry: Math.PI - 0.1 });
    i.push(100, { x: 0, z: 0, ry: -Math.PI + 0.1 });
    const r = i.sample(150)!.ry; // midpoint
    expect(Math.cos(r)).toBeCloseTo(-1, 3);
  });
  test('stale snapshots are ignored', () => {
    const i = make();
    i.push(900, { x: 99, z: 99, ry: 0 });
    expect(i.sample(5000)).toEqual({ x: 10, z: 20, ry: 1 });
  });
});

test('reset clears history', () => {
  const i = new Interpolator();
  i.push(1000, { x: 1, z: 1, ry: 0 });
  i.reset();
  expect(i.sample(2000)).toBeNull();
  i.push(10, { x: 2, z: 2, ry: 0 }); // earlier timestamp accepted after reset
  expect(i.sample(2000)).toEqual({ x: 2, z: 2, ry: 0 });
});

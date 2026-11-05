import { describe, expect, test } from 'vitest';
import { FrameGate, RefreshEstimator } from '../src/three/frameCap';

/** rAF ticks at `hz` for `ms` (optionally jittered); returns the timestamps that rendered. */
function ticks(gate: FrameGate, hz: number, ms: number, jitter = (_i: number) => 0): number[] {
  const out: number[] = [];
  for (let i = 0, t = 0; t < ms; i++, t = (i * 1000) / hz) {
    const now = 1000 + t + jitter(i);
    if (gate.shouldRender(now)) out.push(now);
  }
  return out;
}

describe('FrameGate (~60 fps cap)', () => {
  test('165 Hz display: ~60 renders per second (not 55: keeps a 60 Hz cadence), never two ticks in a row', () => {
    const r = ticks(new FrameGate(), 165, 1000);
    expect(r.length).toBeGreaterThanOrEqual(59);
    expect(r.length).toBeLessThanOrEqual(61);
    for (let i = 1; i < r.length; i++) expect(r[i] - r[i - 1]).toBeGreaterThan(1000 / 165 + 1);
  });

  test('144 Hz: ~60 renders per second (a naive "≥ 14.7 ms since last render" gate would give 48)', () => {
    const r = ticks(new FrameGate(), 144, 1000);
    expect(r.length).toBeGreaterThanOrEqual(59);
    expect(r.length).toBeLessThanOrEqual(61);
  });

  test('120 Hz: every other tick', () => {
    const r = ticks(new FrameGate(), 120, 1000);
    expect(r.length).toBeGreaterThanOrEqual(59);
    expect(r.length).toBeLessThanOrEqual(61);
  });

  test('60 Hz with ±1 ms jitter: every tick renders', () => {
    const r = ticks(new FrameGate(), 60, 1000, (i) => (i % 2 ? 1 : -1));
    expect(r).toHaveLength(60);
  });

  test('a slow display (30 Hz) renders every tick', () => {
    expect(ticks(new FrameGate(), 30, 1000)).toHaveLength(30);
  });

  test('after a stall it renders right away and does not burst to catch up', () => {
    const gate = new FrameGate();
    expect(gate.shouldRender(0)).toBe(true);
    expect(gate.shouldRender(500)).toBe(true);
    expect(gate.shouldRender(506)).toBe(false);
    expect(gate.shouldRender(512)).toBe(false);
    expect(gate.shouldRender(518)).toBe(true);
  });
});

describe('RefreshEstimator', () => {
  test('tracks the display interval: GPU-delayed ticks (20 ms) among vsync ticks (6.06 ms) read as 6.06', () => {
    const r = new RefreshEstimator();
    expect(r.value()).toBe(0);
    for (let i = 0; i < 200; i++) r.observe(i % 3 ? 6.06 : 20);
    expect(r.value()).toBeCloseTo(6.06);
  });

  test('forgets old minima after its window so a display change is picked up', () => {
    const r = new RefreshEstimator();
    for (let i = 0; i < 300; i++) r.observe(6.06);
    for (let i = 0; i < 600; i++) r.observe(16.7);
    expect(r.value()).toBeCloseTo(16.7);
  });

  test('one jittery short interval does not drag the estimate down (low percentile, not the minimum)', () => {
    const r = new RefreshEstimator();
    for (let i = 0; i < 200; i++) r.observe(i === 100 ? 3 : 16.7 + (i % 3) * 0.2);
    expect(r.value()).toBeGreaterThanOrEqual(16.7);
    expect(r.value()).toBeLessThan(17);
  });

  test('a 30 Hz cadence (battery saver) reads as ~33 ms within ~1 s of ticks', () => {
    const r = new RefreshEstimator();
    for (let i = 0; i < 30; i++) r.observe(i % 7 ? 33.3 : 34.5);
    expect(r.value()).toBeCloseTo(33.3);
  });

  test('ignores nonsense intervals', () => {
    const r = new RefreshEstimator();
    r.observe(0);
    r.observe(-5);
    r.observe(NaN);
    expect(r.value()).toBe(0);
  });
});

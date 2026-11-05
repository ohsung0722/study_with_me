import { describe, expect, test } from 'vitest';
import {
  FAST_MS, MAX_REFRESH_MS, MAX_SAMPLE_MS, PIXEL_RATIO_CAP, PIXEL_RATIO_FLOOR, SLOW_MS, WINDOW_MS, initialQuality, qualitySample, stepQuality,
  type QualityChange, type QualityState,
} from '../src/three/quality';

/** Feed `ms` worth of frames of `frameMs` each; returns every change reported. */
function feed(q: QualityState, frameMs: number, ms: number, fastMs?: number): QualityChange[] {
  const out: QualityChange[] = [];
  for (let t = 0; t < ms; t += frameMs) {
    const c = stepQuality(q, frameMs, fastMs);
    if (c !== 'none') out.push(c);
  }
  return out;
}

describe('initialQuality', () => {
  test('starts at high tier and min(devicePixelRatio, 1.5)', () => {
    expect(PIXEL_RATIO_CAP).toBe(1.5);
    expect(initialQuality(2)).toMatchObject({ ratio: 1.5, cap: 1.5, tier: 'high' });
    expect(initialQuality(1.25)).toMatchObject({ ratio: 1.25, cap: 1.25 });
    expect(initialQuality(1)).toMatchObject({ ratio: 1, cap: 1 });
  });
});

describe('adaptive resolution', () => {
  test('slow frames (avg > 22 ms over ~1.5 s) step the ratio down ×0.85', () => {
    const q = initialQuality(2);
    expect(feed(q, 30, WINDOW_MS - 30)).toEqual([]); // not a full window yet
    expect(feed(q, 30, 60)).toEqual(['ratio']);
    expect(q.ratio).toBeCloseTo(1.5 * 0.85);
  });

  test('keeps stepping down to the 0.6 floor, never below', () => {
    const q = initialQuality(2);
    feed(q, 40, 30_000);
    expect(q.ratio).toBe(PIXEL_RATIO_FLOOR);
  });

  test('frames in the 13–22 ms band hold the ratio (hysteresis band)', () => {
    const q = initialQuality(2);
    feed(q, 30, WINDOW_MS + 30); // one step down
    const r = q.ratio;
    expect(feed(q, 17, 20_000)).toEqual([]);
    expect(q.ratio).toBe(r);
    expect(SLOW_MS).toBe(22);
    expect(FAST_MS).toBe(13);
  });

  test('fast frames (< 13 ms) for ~3 s step back up, up to the cap', () => {
    const q = initialQuality(2);
    feed(q, 30, WINDOW_MS + 30);
    expect(q.ratio).toBeLessThan(1.5);
    expect(feed(q, 8, 1600)).toEqual([]); // one fast window is not enough
    expect(feed(q, 8, 1600)).toEqual(['ratio']);
    expect(q.ratio).toBeCloseTo(1.5);
    expect(feed(q, 8, 20_000)).toEqual([]); // already at the cap
    expect(q.ratio).toBe(1.5);
  });

  test('a step up that turns out too slow backs off: the next step up waits twice as long', () => {
    const q = initialQuality(2);
    feed(q, 30, WINDOW_MS + 30);                     // down
    feed(q, 8, 3200);                               // up after ~3 s
    expect(q.ratio).toBeCloseTo(1.5);
    expect(feed(q, 40, WINDOW_MS + 30)).toEqual(['ratio']); // too slow at the cap → down again
    expect(feed(q, 8, 4800)).toEqual([]);            // ~3 s is no longer enough …
    expect(feed(q, 8, 1700)).toEqual(['ratio']);     // … it takes ~6 s now
  });

  test('ignores stalls (hidden tab, GC) longer than MAX_SAMPLE_MS', () => {
    const q = initialQuality(2);
    expect(feed(q, MAX_SAMPLE_MS + 1, 20_000)).toEqual([]);
    expect(q.ratio).toBe(1.5);
  });

  test('a caller-supplied fast threshold (vsync-bound displays) lets 16.7 ms frames count as fast', () => {
    const q = initialQuality(2);
    feed(q, 30, WINDOW_MS + 30);
    expect(feed(q, 16.7, 3400, 18)).toEqual(['ratio']);
    expect(q.ratio).toBeCloseTo(1.5);
  });
});

describe('quality tier', () => {
  test('drops to low once when still slow (> 22 ms) for ~3 s at the minimum ratio', () => {
    const q = initialQuality(2);
    const changes = feed(q, 40, 60_000);
    expect(changes.filter((c) => c === 'tier')).toEqual(['tier']);
    expect(q.tier).toBe('low');
    expect(q.ratio).toBe(PIXEL_RATIO_FLOOR);
  });

  test('does not drop while the ratio can still go down', () => {
    const q = initialQuality(2);
    const changes = feed(q, 40, WINDOW_MS * 4 + 40);
    expect(changes).not.toContain('tier');
    expect(q.tier).toBe('high');
  });

  test('never flips back to high, even when fast again', () => {
    const q = initialQuality(2);
    feed(q, 40, 60_000);
    feed(q, 5, 120_000);
    expect(q.tier).toBe('low');
    expect(q.ratio).toBe(1.5); // resolution still recovers
  });
});

describe('qualitySample (the scene loop wiring: thresholds relative to the display refresh)', () => {
  /** Feed `ms` of `sampleMs` samples through qualitySample with a given refresh estimate. */
  function run(q: QualityState, sampleMs: number, refreshMs: number, ms: number): QualityChange[] {
    const out: QualityChange[] = [];
    for (let t = 0; t < ms; t += sampleMs) {
      const c = qualitySample(q, sampleMs, refreshMs);
      if (c !== 'none') out.push(c);
    }
    return out;
  }

  test('vsync-bound 30 Hz cadence (33.3 ms ticks, 33.3 ms refresh): no ratio or tier change, ever', () => {
    const q = initialQuality(2);
    expect(run(q, 33.3, 33.3, 120_000)).toEqual([]);
    expect(q).toMatchObject({ ratio: 1.5, tier: 'high' });
  });

  test('40–48 Hz panels: vsync-bound samples hold', () => {
    for (const hz of [40, 48]) {
      const q = initialQuality(2);
      expect(run(q, 1000 / hz, 1000 / hz, 60_000)).toEqual([]);
    }
  });

  test('40 ms samples on a 60 Hz display (16.7 ms refresh) still step down', () => {
    const q = initialQuality(2);
    expect(run(q, 40, 16.7, WINDOW_MS + 40)).toEqual(['ratio']);
    expect(q.ratio).toBeLessThan(1.5);
  });

  test('a vsync-bound 60 Hz display steps back up after a dip', () => {
    const q = initialQuality(2);
    run(q, 40, 16.7, WINDOW_MS + 40);
    expect(run(q, 16.7, 16.7, 3500)).toEqual(['ratio']);
    expect(q.ratio).toBeCloseTo(1.5);
  });

  test('the refresh used for the thresholds is capped (a GPU-bound 20 fps cadence is not mistaken for a 20 Hz display)', () => {
    expect(MAX_REFRESH_MS).toBeLessThan(40);
    const q = initialQuality(2);
    expect(run(q, 50, 50, WINDOW_MS + 50)).toEqual(['ratio']);
  });

  test('unknown refresh (0) falls back to the absolute thresholds', () => {
    const q = initialQuality(2);
    expect(run(q, 30, 0, WINDOW_MS + 30)).toEqual(['ratio']);
  });
});

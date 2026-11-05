// Adaptive resolution + quality tier. Pure: the scene feeds one frame-time sample per rendered frame and applies the
// changes it reports. Frame time is averaged over WINDOW_MS windows:
//  - avg > SLOW_MS: pixel ratio × STEP_DOWN (floor PIXEL_RATIO_FLOOR); already at the floor for LOW_AFTER_MS → tier
//    'low' (once per session, never back);
//  - avg < fast threshold for UP_AFTER_MS: pixel ratio ÷ STEP_DOWN (up to the cap);
//  - in between: hold (hysteresis band). A step up that is followed straight away by a step down doubles the
//    wait before the next step up, so the ratio doesn't oscillate around a borderline value.
export const PIXEL_RATIO_CAP = 1.5;
export const PIXEL_RATIO_FLOOR = 0.6;
export const STEP_DOWN = 0.85;
export const SLOW_MS = 22;
export const FAST_MS = 13;
export const WINDOW_MS = 1500;
export const UP_AFTER_MS = 3000;
export const LOW_AFTER_MS = 3000;
export const MAX_UP_AFTER_MS = 48_000;
export const MAX_SAMPLE_MS = 250; // longer frames are stalls (hidden tab, GC, a shader compile), not load
const FAILED_UP_MS = 2 * WINDOW_MS + 500; // a step down this soon after a step up means the step up failed
// Display-relative thresholds: a vsync-bound cadence (30 Hz battery saver, 40–48 Hz panels) is not overload.
export const FAST_REFRESH_K = 1.1;
export const SLOW_REFRESH_K = 1.25;
// Refresh intervals above this (< ~30 Hz) are not trusted as a display rate: a GPU-bound 60 Hz display that only
// manages every 3rd vsync looks the same from rAF timing alone, and must still step down.
export const MAX_REFRESH_MS = 34;

export type Tier = 'high' | 'low';
export type QualityChange = 'none' | 'ratio' | 'tier';

export interface QualityState {
  ratio: number;
  cap: number;
  floor: number;
  tier: Tier;
  winSum: number;     // frame-time sum and count in the current window
  winN: number;
  fastMs: number;     // consecutive fast time
  slowFloorMs: number; // consecutive slow time at the floor
  upAfterMs: number;  // fast time needed before a step up (grows on failed step ups)
  sinceUpMs: number;  // time since the last step up
}

export function initialQuality(devicePixelRatio: number): QualityState {
  const cap = Math.min(Math.max(devicePixelRatio || 1, 0.1), PIXEL_RATIO_CAP);
  return {
    ratio: cap, cap, floor: Math.min(PIXEL_RATIO_FLOOR, cap), tier: 'high',
    winSum: 0, winN: 0, fastMs: 0, slowFloorMs: 0, upAfterMs: UP_AFTER_MS, sinceUpMs: Infinity,
  };
}

/**
 * Feed one frame time. Mutates `q`; returns what changed ('ratio': apply q.ratio, 'tier': apply q.tier).
 * `fastMs` / `slowMs` let the caller raise the thresholds on displays whose refresh interval is long.
 */
export function stepQuality(q: QualityState, frameMs: number, fastMs = FAST_MS, slowMs = SLOW_MS): QualityChange {
  if (!(frameMs > 0) || frameMs > MAX_SAMPLE_MS) return 'none';
  q.winSum += frameMs;
  q.winN++;
  q.sinceUpMs += frameMs;
  if (q.winSum < WINDOW_MS) return 'none';

  const dur = q.winSum, avg = q.winSum / q.winN;
  q.winSum = 0;
  q.winN = 0;
  if (avg > slowMs) {
    q.fastMs = 0;
    if (q.ratio > q.floor + 1e-9) {
      if (q.sinceUpMs <= FAILED_UP_MS) q.upAfterMs = Math.min(MAX_UP_AFTER_MS, q.upAfterMs * 2);
      q.ratio = Math.max(q.floor, q.ratio * STEP_DOWN);
      q.slowFloorMs = 0;
      return 'ratio';
    }
    q.slowFloorMs += dur;
    if (q.tier === 'high' && q.slowFloorMs >= LOW_AFTER_MS) {
      q.tier = 'low';
      return 'tier';
    }
    return 'none';
  }
  q.slowFloorMs = 0;
  if (avg < fastMs) {
    q.fastMs += dur;
    if (q.fastMs >= q.upAfterMs && q.ratio < q.cap - 1e-9) {
      q.ratio = Math.min(q.cap, q.ratio / STEP_DOWN);
      q.fastMs = 0;
      q.sinceUpMs = 0;
      return 'ratio';
    }
    return 'none';
  }
  q.fastMs = 0;
  return 'none';
}

/**
 * The scene loop's wiring: one tick sample with thresholds relative to the measured display refresh interval
 * (0 = unknown → absolute thresholds), so being vsync-bound on a slow display counts as fast, never as overload.
 */
export function qualitySample(q: QualityState, sampleMs: number, refreshMs: number): QualityChange {
  const r = refreshMs > 0 ? Math.min(refreshMs, MAX_REFRESH_MS) : 0;
  return stepQuality(q, sampleMs, Math.max(FAST_MS, r * FAST_REFRESH_K), Math.max(SLOW_MS, r * SLOW_REFRESH_K));
}

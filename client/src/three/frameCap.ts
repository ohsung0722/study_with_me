// Frame cap: render at most ~60 fps on high-refresh displays (game logic still gets the real elapsed time).
export const TARGET_FRAME_MS = 1000 / 60;
export const FRAME_TOLERANCE_MS = 2;

/** Decides, per requestAnimationFrame tick, whether to render. Keeps a steady cadence; resyncs after a stall. */
export class FrameGate {
  private last = -Infinity;

  constructor(private intervalMs = TARGET_FRAME_MS, private toleranceMs = FRAME_TOLERANCE_MS) {}

  shouldRender(now: number): boolean {
    const since = now - this.last;
    if (since < this.intervalMs - this.toleranceMs) return false;
    // on schedule: advance by one interval (no drift); late by more than a frame: restart the cadence from now
    this.last = since > 2 * this.intervalMs ? now : this.last + this.intervalMs;
    return true;
  }

  reset(): void {
    this.last = -Infinity;
  }
}

const REFRESH_TICKS = 120;     // ring of recent rAF tick intervals
const REFRESH_EVERY = 30;      // recompute the estimate every this many ticks (and first after this many)
const REFRESH_PERCENTILE = 0.1;

/**
 * Display refresh interval estimate: a low percentile (10th) of the last REFRESH_TICKS rAF tick intervals.
 * Ticks delayed by a busy GPU are longer, so a low percentile finds the vsync interval; unlike the plain minimum,
 * a single jittery short interval doesn't drag it down. Allocation-free; the sort runs every REFRESH_EVERY ticks.
 */
export class RefreshEstimator {
  private ring = new Float64Array(REFRESH_TICKS);
  private scratch = new Float64Array(REFRESH_TICKS);
  private count = 0;   // intervals stored (≤ REFRESH_TICKS)
  private head = 0;
  private sinceCalc = 0;
  private est = 0;

  observe(intervalMs: number): void {
    if (!(intervalMs > 0) || !Number.isFinite(intervalMs)) return;
    this.ring[this.head] = intervalMs;
    this.head = (this.head + 1) % REFRESH_TICKS;
    if (this.count < REFRESH_TICKS) this.count++;
    if (++this.sinceCalc >= REFRESH_EVERY) {
      this.sinceCalc = 0;
      const n = this.count, s = this.scratch;
      s.set(this.ring);
      s.fill(Infinity, n); // unfilled slots sort to the end
      s.sort();
      this.est = s[Math.floor(n * REFRESH_PERCENTILE)];
    }
  }

  /** 0 until REFRESH_EVERY intervals were observed. */
  value(): number {
    return this.est;
  }
}

// ---------- pre-measured display refresh ----------
// The in-loop estimate can't tell a slow display from a GPU-bound one (both give long rAF intervals). So the display
// refresh is measured once while nothing heavy renders (during the entry screen, before any WebGL work) and used
// as the quality controller's fixed reference; the in-loop estimate may only lower it.
const MIN_REFRESH_SAMPLES = 10;
const MAX_REFRESH_SAMPLE_MS = 250; // longer gaps are stalls (hidden tab, GC), not a refresh rate

/** Robust refresh interval from idle rAF intervals: 10th percentile of the plausible ones; 0 if too few. */
export function refreshFromIntervals(intervals: readonly number[]): number {
  const ok = intervals.filter((v) => v > 0 && v <= MAX_REFRESH_SAMPLE_MS);
  if (ok.length < MIN_REFRESH_SAMPLES) return 0;
  ok.sort((a, b) => a - b);
  return ok[Math.floor(ok.length * REFRESH_PERCENTILE)];
}

/**
 * Sample requestAnimationFrame intervals for about `ms` and reduce them with refreshFromIntervals. Run it while
 * nothing heavy renders. Resolves 0 (unknown) if rAF doesn't tick (hidden tab) within ms + 500.
 */
export function measureRefresh(ms = 800, raf: (cb: (now: number) => void) => unknown = requestAnimationFrame): Promise<number> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let first = -1, prev = -1, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve(refreshFromIntervals(intervals));
    };
    const guard = setTimeout(finish, ms + 500);
    const tick = (now: number) => {
      if (done) return;
      if (prev >= 0) intervals.push(now - prev);
      else first = now;
      prev = now;
      if (now - first >= ms) finish();
      else raf(tick);
    };
    raf(tick);
  });
}

/** Quality controller reference: the pre-measured refresh; the in-loop estimate may only lower it or stand in for it. */
export function refreshReference(premeasuredMs: number, inLoopMs: number): number {
  if (premeasuredMs > 0) return inLoopMs > 0 ? Math.min(premeasuredMs, inLoopMs) : premeasuredMs;
  return inLoopMs;
}

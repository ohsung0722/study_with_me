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

const REFRESH_WINDOW = 240; // ticks

/** Display refresh interval estimate: the shortest rAF tick interval over the last REFRESH_WINDOW–2×REFRESH_WINDOW ticks. */
export class RefreshEstimator {
  private cur = Infinity;   // min in the current window
  private prev = Infinity;  // min in the previous window
  private n = 0;

  observe(intervalMs: number): void {
    if (!(intervalMs > 0)) return;
    if (intervalMs < this.cur) this.cur = intervalMs;
    if (++this.n >= REFRESH_WINDOW) {
      this.prev = this.cur;
      this.cur = Infinity;
      this.n = 0;
    }
  }

  /** Shortest interval over the current and previous window; 0 until something was observed. */
  value(): number {
    const v = Math.min(this.cur, this.prev);
    return Number.isFinite(v) ? v : 0;
  }
}

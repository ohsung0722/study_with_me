// The greeting I may still accept ("인사 받기"): the latest `greeted` sender, valid for GREET_TOAST_MS (as the server).
import { GREET_TOAST_MS } from '@studyverse/shared';

export class PendingGreet {
  private from: string | null = null;
  private at = 0;

  set(fromId: string, nowMs: number): void {
    this.from = fromId;
    this.at = nowMs;
  }

  /** The sender if the greeting is still acceptable, else null. */
  get(nowMs: number): string | null {
    if (this.from !== null && nowMs - this.at >= GREET_TOAST_MS) this.from = null;
    return this.from;
  }

  /** Like get(), but clears it (accepting is one-shot). With `fromId`, only that sender is taken. */
  take(nowMs: number, fromId?: string): string | null {
    const f = this.get(nowMs);
    if (f === null || (fromId !== undefined && f !== fromId)) return null;
    this.from = null;
    return f;
  }

  /** Drop a pending greeting from a player who left. */
  forget(id: string): void {
    if (this.from === id) this.from = null;
  }
}

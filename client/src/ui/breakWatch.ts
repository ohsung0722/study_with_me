// Break-end alert decision. Pure: the Game feeds my status + server time every frame and keeps the memo.
import type { Status } from '@studyverse/shared';

/**
 * `alertedFor` is the endsAt we already alerted for (null = none). Alerts once per break: when
 * serverNow reaches endsAt and that endsAt hasn't been alerted yet. A new endsAt (new break or
 * changed minutes) alerts again.
 */
export function breakEndCheck(
  status: Status, serverNow: number, alertedFor: number | null,
): { alert: boolean; alertedFor: number | null } {
  if (status.kind === 'break' && serverNow >= status.endsAt && alertedFor !== status.endsAt) {
    return { alert: true, alertedFor: status.endsAt };
  }
  return { alert: false, alertedFor };
}

/** Seconds of break left (clamped at 0), or null when not on break. */
export function breakLeftSec(status: Status, serverNow: number): number | null {
  return status.kind === 'break' ? Math.max(0, (status.endsAt - serverNow) / 1000) : null;
}

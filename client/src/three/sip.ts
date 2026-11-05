// Occasional "sip" while holding a drink: every 6–10 s of eligibility, a ~1 s arm-to-mouth motion.

export const SIP_MS = 1000;
const GAP_MIN_MS = 6000, GAP_SPAN_MS = 4000;

export interface SipState { nextIn: number; left: number; rand: () => number }

export function newSipState(rand: () => number = Math.random): SipState {
  return { nextIn: GAP_MIN_MS + rand() * GAP_SPAN_MS, left: 0, rand };
}

/**
 * Advances the sip timer and returns the arm lift 0..1 (0 = arm down, 1 = cup at the mouth).
 * `canSip` = holding a drink, not seated, not waving; when false any ongoing sip is cut and the
 * countdown pauses.
 */
export function stepSip(s: SipState, dtMs: number, canSip: boolean): number {
  if (!canSip) {
    s.left = 0;
    return 0;
  }
  if (s.left > 0) {
    s.left = Math.max(0, s.left - dtMs);
    if (s.left === 0) return 0;
    return Math.sin(Math.PI * (1 - s.left / SIP_MS));
  }
  s.nextIn -= dtMs;
  if (s.nextIn <= 0) {
    s.left = SIP_MS;
    s.nextIn = GAP_MIN_MS + s.rand() * GAP_SPAN_MS;
  }
  return 0;
}

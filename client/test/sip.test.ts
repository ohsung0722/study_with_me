import { describe, expect, test } from 'vitest';
import { newSipState, SIP_MS, stepSip } from '../src/three/sip';

const run = (s: ReturnType<typeof newSipState>, ms: number, can: boolean, step = 50) => {
  let lift = 0, maxLift = 0;
  for (let t = 0; t < ms; t += step) { lift = stepSip(s, step, can); maxLift = Math.max(maxLift, lift); }
  return { lift, maxLift };
};

describe('stepSip', () => {
  test('first sip comes after 6–10 s of eligibility, lasts ~1 s, then the next is 6–10 s later', () => {
    const s = newSipState(() => 0.5); // first sip in 8 s
    expect(run(s, 7_900, true).maxLift).toBe(0);
    const sip = run(s, SIP_MS + 200, true);
    expect(sip.maxLift).toBeGreaterThan(0.95); // arm reaches the mouth mid-sip
    expect(sip.lift).toBe(0);                  // and is back down after ~1 s
    expect(run(s, 5_500, true).maxLift).toBe(0); // next sip not before 6 s
  });

  test('not eligible (no drink / seated / waving) → never sips and an ongoing sip stops', () => {
    const s = newSipState(() => 0);
    expect(run(s, 60_000, false).maxLift).toBe(0);
    run(s, 6_000, true);
    expect(stepSip(s, 400, true)).toBeGreaterThan(0); // mid-sip
    expect(stepSip(s, 16, false)).toBe(0);
    expect(s.left).toBe(0);
  });
});

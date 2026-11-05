import { GREET_COOLDOWN_MS, GREET_RANGE, zoneAt, type GreetResult, type PlayerView } from '@studyverse/shared';

const isFocus = (p: PlayerView) => p.status.kind === 'studying' && p.status.focus;

/** Pure: who (if anyone) a greeting from `sender` reaches. Order: sender focus, cooldown, nearest eligible. */
export function pickGreetTarget(
  sender: PlayerView & { lastGreetAt: number }, others: PlayerView[], now: number,
): GreetResult {
  if (isFocus(sender)) return { ok: false, reason: 'focus' };
  if (now - sender.lastGreetAt < GREET_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
  const senderZone = zoneAt(sender.x, sender.z);
  let best: PlayerView | null = null;
  let bestD = Infinity;
  for (const o of others) {
    if (o.id === sender.id || o.isNpc || isFocus(o)) continue;
    if (zoneAt(o.x, o.z) !== senderZone) continue; // no greeting through walls
    const d = Math.hypot(o.x - sender.x, o.z - sender.z);
    if (d <= GREET_RANGE && d < bestD) { best = o; bestD = d; }
  }
  return best ? { ok: true, targetId: best.id } : { ok: false, reason: 'noTarget' };
}

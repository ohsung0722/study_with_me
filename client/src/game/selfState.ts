// Optimistic "stand up" for my own view: the server confirms with playerUpdated (and myToday) one round trip later.
import { kstDayKey, type PlayerView } from '@studyverse/shared';
import { liveTodaySec } from './clock';

type Today = { sec: number; day: string };

/**
 * Stand now: no seat and no studying status, so the focus HUD/vignette/🔒 go away at once. The ended session is
 * folded into my today total (the server's myToday then replaces it), so the HUD neither drops nor double counts.
 */
export function standLocally(view: PlayerView, today: Today, serverNow: number): { view: PlayerView; today: Today } {
  if (view.status.kind !== 'studying') return { view: { ...view, seatId: null }, today };
  return {
    view: { ...view, seatId: null, status: { kind: 'none' } },
    today: { sec: liveTodaySec(today, view.status, serverNow), day: kstDayKey(serverNow) },
  };
}

/** A playerUpdated for me sent before the server handled my stand: keep me standing and not studying. */
export function maskBeforeStand(v: PlayerView): PlayerView {
  return { ...v, seatId: null, status: v.status.kind === 'studying' ? { kind: 'none' } : v.status };
}

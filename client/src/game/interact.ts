// Which "E" prompt to show. Pure; mirrors the server's rules so the prompt never offers something the
// server will reject: seats and greet targets must be in my zone (zones from positions, like the server),
// occupied = some player's seatId, NPCs are never greeted, focused players can't be greeted.
import { GREET_RANGE, INTERACT_RANGE, MAP, zoneAt, type PlayerView } from '@studyverse/shared';

export type Prompt =
  | { kind: 'sit'; seatId: string; text: 'E 앉기' } | { kind: 'stand'; text: 'E 일어나기' }
  | { kind: 'greet'; targetId: string; text: 'E 인사하기' } | { kind: 'focusBlocked'; text: '🔒 집중 중' }
  | { kind: 'machine'; id: 'coffee' | 'vending'; text: 'E 음료 고르기' } | { kind: 'radio'; text: 'E 배경음 바꾸기' }
  | { kind: 'board'; text: 'E 기록판 보기' } | { kind: 'acceptGreet'; fromId: string; text: 'E 인사 받기' };

const isFocus = (p: PlayerView) => p.status.kind === 'studying' && p.status.focus;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Nearest item within `range` (inclusive), or null. */
function nearest<T extends { x: number; z: number }>(me: PlayerView, items: Iterable<T>, range: number): T | null {
  let best: T | null = null, bestD = Infinity;
  for (const it of items) {
    const d = dist(me, it);
    if (d <= range && d < bestD) { best = it; bestD = d; }
  }
  return best;
}

/**
 * Priority: seated → stand (acceptGreet instead if a greeting is pending and I'm not focused)
 * > acceptGreet > coffee/vending/radio/board (INTERACT_RANGE) > free seat (INTERACT_RANGE)
 * > person (GREET_RANGE; focusBlocked if only focused people are near; nothing while I'm focused).
 */
export function pickPrompt(me: PlayerView, others: PlayerView[], pendingGreetFrom: string | null): Prompt | null {
  const meFocus = isFocus(me);
  const accept: Prompt | null = pendingGreetFrom && !meFocus
    ? { kind: 'acceptGreet', fromId: pendingGreetFrom, text: 'E 인사 받기' }
    : null;
  if (me.seatId) return accept ?? { kind: 'stand', text: 'E 일어나기' };
  if (accept) return accept;

  const myZone = zoneAt(me.x, me.z);

  const fixture = nearest(me, MAP.interactables.filter(i => zoneAt(i.x, i.z) === myZone), INTERACT_RANGE);
  if (fixture) {
    switch (fixture.id) {
      case 'coffee': case 'vending': return { kind: 'machine', id: fixture.id, text: 'E 음료 고르기' };
      case 'radio': return { kind: 'radio', text: 'E 배경음 바꾸기' };
      case 'board': return { kind: 'board', text: 'E 기록판 보기' };
    }
  }

  const taken = new Set<string>();
  for (const o of others) if (o.seatId) taken.add(o.seatId);
  const seat = nearest(me, MAP.seats.filter(s => s.zone === myZone && !taken.has(s.id)), INTERACT_RANGE);
  if (seat) return { kind: 'sit', seatId: seat.id, text: 'E 앉기' };

  if (meFocus) return null;
  const people = others.filter(o => o.id !== me.id && !o.isNpc && zoneAt(o.x, o.z) === myZone);
  const target = nearest(me, people.filter(o => !isFocus(o)), GREET_RANGE);
  if (target) return { kind: 'greet', targetId: target.id, text: 'E 인사하기' };
  if (nearest(me, people.filter(isFocus), GREET_RANGE)) return { kind: 'focusBlocked', text: '🔒 집중 중' };
  return null;
}

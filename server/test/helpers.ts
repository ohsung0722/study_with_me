import type { Outbox } from '../src/game/outbox';

export interface Call { kind: 'toAll' | 'toAllExcept' | 'toPlayer' | 'setRoom' | 'kick'; id?: string; ev: string; args: unknown[] }

export class FakeOutbox implements Outbox {
  calls: Call[] = [];
  toAll(ev: any, ...args: any[]) { this.calls.push({ kind: 'toAll', ev, args }); }
  toAllExcept(id: string, ev: any, ...args: any[]) { this.calls.push({ kind: 'toAllExcept', id, ev, args }); }
  toPlayer(id: string, ev: any, ...args: any[]) { this.calls.push({ kind: 'toPlayer', id, ev, args }); }
  setRoom(id: string, room: string | null) { this.calls.push({ kind: 'setRoom', id, ev: 'setRoom', args: [room] }); }
  kick(id: string, ev: 'replaced') { this.calls.push({ kind: 'kick', id, ev, args: [] }); }
  find(kind: Call['kind'], ev: string): Call[] { return this.calls.filter((c) => c.kind === kind && c.ev === ev); }
}

export function fakeClock(start = 0) {
  let t = start;
  const now = () => t;
  return { now, set: (v: number) => { t = v; }, advance: (d: number) => { t += d; } };
}

/** Test-only: let enough fake time pass that movement validation allows a long step, then move. */
export function moveAfter(
  world: { move(id: string, x: number, z: number, ry: number): void },
  clock: { advance(d: number): void },
  id: string, x: number, z: number, ry = 0, ms = 10_000,
) {
  clock.advance(ms);
  world.move(id, x, z, ry);
}

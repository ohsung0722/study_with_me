import { describe, expect, test } from 'vitest';
import { BUILDING_CAPACITY, MAP, kstDayKey, seatById, type Profile } from '@studyverse/shared';
import { World } from '../src/game/world';
import { openStore } from '../src/store/store';
import { FakeOutbox, fakeClock, moveAfter } from './helpers';

const prof = (anonId: string, nickname = '공부왕'): Profile => ({
  anonId, nickname, breakMinutes: 10,
  appearance: { hair: 'short', hairColor: '#000000', shirtColor: '#3366ff' },
});

function setup(start = 0) {
  const clock = fakeClock(start);
  clockRef = clock;
  const store = openStore(':memory:');
  const out = new FakeOutbox();
  const world = new World({ now: clock.now, store, out });
  return { clock, store, out, world };
}
let clockRef: ReturnType<typeof fakeClock>;
function nearSeat(world: World, id: string, seatId: string) {
  const s = seatById(seatId)!;
  const t0 = clockRef.now();
  // sofa props block their own front edge from behind; seat points of sofas are open floor
  const dz = s.kind === 'sofa' ? 0 : s.facing === 0 ? -1 : 1;
  moveAfter(world, clockRef, id, s.x, s.z + dz, 0);
  clockRef.set(t0); // keep the scenario's own timeline intact
}
const joinAt = (w: World, id: string, anon: string, seatId: string) => {
  w.join(id, prof(anon, `user${anon}`));
  nearSeat(w, id, seatId);
};

describe('World seats/timer', () => {
  test('join returns self view at spawn and broadcasts playerJoined to others', () => {
    const { world, out } = setup();
    world.join('a', prof('A', '가나다'));
    const r = world.join('b', prof('B', '라마바'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.selfId).toBe('b');
    expect(r.players.map((p) => p.id).sort()).toEqual(['a', 'b']);
    const me = r.players.find((p) => p.id === 'b')!;
    expect(me).toMatchObject({ x: MAP.spawn.x, z: MAP.spawn.z, ry: MAP.spawn.facing, seatId: null, isNpc: false, drink: null, nickname: '라마바' });
    expect(me.status).toEqual({ kind: 'none' });
    const ev = out.find('toAllExcept', 'playerJoined').at(-1)!;
    expect(ev.id).toBe('b');
    expect((ev.args[0] as { id: string }).id).toBe('b');
  });

  test('join rejects bad nickname and 51st real player (full)', () => {
    const { world } = setup();
    expect(world.join('x', prof('X', 'a'))).toEqual({ ok: false, reason: 'nickname' });
    for (let i = 0; i < BUILDING_CAPACITY; i++) expect(world.join(`c${i}`, prof(`U${i}`, `user${i}`)).ok).toBe(true);
    expect(world.join('late', prof('L', '늦게왔다'))).toEqual({ ok: false, reason: 'full' });
    expect(world.realCount()).toBe(BUILDING_CAPACITY);
  });

  test('same anonId joining again kicks old connection with replaced and saves its session', () => {
    const { world, out, store, clock } = setup(0);
    joinAt(world, 'old', 'A', 'R01');
    expect(world.sit('old', 'R01')).toEqual({ ok: true });
    clock.set(60_000);
    const r = world.join('new', prof('A', 'userA'));
    expect(r.ok).toBe(true);
    expect(out.calls.some((c) => c.kind === 'kick' && c.id === 'old' && c.ev === 'replaced')).toBe(true);
    expect(world.view('old')).toBeUndefined();
    const left = out.find('toAllExcept', 'playerLeft').find((c) => (c.args[0] as { id: string }).id === 'old')!;
    expect(left.args[0]).toEqual({ id: 'old', npc: false });
    expect(store.userDaySec('A', kstDayKey(60_000))).toBe(60);
    expect(world.realCount()).toBe(1);
  });

  test('sit desk → studying focus=true; studyChair → focus=false; sofa keeps the lounge break', () => {
    const { world, out } = setup(1000);
    joinAt(world, 'a', 'A', 'R01');
    joinAt(world, 'b', 'B', 'A1');
    joinAt(world, 'c', 'C', 'S1');
    expect(world.sit('a', 'R01')).toEqual({ ok: true });
    expect(world.sit('b', 'A1')).toEqual({ ok: true });
    expect(world.sit('c', 'S1')).toEqual({ ok: true });
    expect(world.view('a')!.status).toEqual({ kind: 'studying', startedAt: 1000, focus: true });
    expect(world.view('b')!.status).toEqual({ kind: 'studying', startedAt: 1000, focus: false });
    expect(world.view('c')!.status).toEqual({ kind: 'break', endsAt: 11_000 + 10 * 60000 }); // entered the lounge 10s after join
    const va = world.view('a')!;
    expect(va).toMatchObject({ x: seatById('R01')!.x, z: seatById('R01')!.z, ry: seatById('R01')!.facing, seatId: 'R01' });
    expect(out.find('toAll', 'playerUpdated').length).toBe(6); // 3 zone changes + 3 sits
  });

  test('second player sitting on the same seat gets taken', () => {
    const { world } = setup();
    joinAt(world, 'a', 'A', 'R01');
    joinAt(world, 'b', 'B', 'R01');
    expect(world.sit('a', 'R01')).toEqual({ ok: true });
    expect(world.sit('b', 'R01')).toEqual({ ok: false, reason: 'taken' });
    expect(world.view('b')!.seatId).toBeNull();
  });

  test('sit too far away → far; unknown seat → unknown', () => {
    const { world } = setup();
    world.join('a', prof('A', '멀리있음'));
    expect(world.sit('a', 'R01')).toEqual({ ok: false, reason: 'far' });
    expect(world.sit('a', 'NOPE')).toEqual({ ok: false, reason: 'unknown' });
  });

  test('stand saves a session of exact elapsed seconds and sends myToday', () => {
    const { world, out, store, clock } = setup(0);
    joinAt(world, 'a', 'A', 'R01');
    world.sit('a', 'R01');
    clock.set(90_000);
    world.stand('a');
    expect(store.userDaySec('A', kstDayKey(0))).toBe(90);
    const m = out.find('toPlayer', 'myToday').at(-1)!;
    expect(m.id).toBe('a');
    expect(m.args[0]).toEqual({ sec: 90 });
    expect(world.view('a')).toMatchObject({ seatId: null, status: { kind: 'none' } });
  });

  test('leave while seated saves session and frees seat', () => {
    const { world, out, store, clock } = setup(0);
    joinAt(world, 'a', 'A', 'R01');
    joinAt(world, 'b', 'B', 'R01');
    world.sit('a', 'R01');
    clock.set(30_000);
    world.leave('a');
    expect(store.userDaySec('A', kstDayKey(0))).toBe(30);
    expect(world.view('a')).toBeUndefined();
    expect(out.find('toAllExcept', 'playerLeft').at(-1)!.args[0]).toEqual({ id: 'a', npc: false });
    expect(world.sit('b', 'R01')).toEqual({ ok: true });
    world.leave('nobody'); // no-op
  });

  test('shutdown saves all open sessions', () => {
    const { world, store, clock } = setup(0);
    joinAt(world, 'a', 'A', 'R01');
    joinAt(world, 'b', 'B', 'A1');
    world.sit('a', 'R01');
    world.sit('b', 'A1');
    clock.set(45_000);
    world.shutdown();
    expect(store.userDaySec('A', kstDayKey(0))).toBe(45);
    expect(store.userDaySec('B', kstDayKey(0))).toBe(45);
    world.shutdown(); // idempotent: no double counting
    expect(store.userDaySec('A', kstDayKey(0))).toBe(45);
  });
});

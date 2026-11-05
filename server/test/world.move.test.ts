import { describe, expect, test } from 'vitest';
import { BUILDING_CAPACITY, INTERACT_RANGE, MAP, TODAY_BROADCAST_MS, kstDayKey, seatById, type Profile } from '@studyverse/shared';
import { World } from '../src/game/world';
import { openStore } from '../src/store/store';
import { FakeOutbox, fakeClock, moveAfter } from './helpers';

const prof = (anonId: string, nickname = '공부왕', breakMinutes: 5 | 10 | 15 = 10): Profile => ({
  anonId, nickname, breakMinutes,
  appearance: { hair: 'short', hairColor: '#000000', shirtColor: '#3366ff' },
});

function setup(start = 1_000_000) {
  const clock = fakeClock(start);
  const store = openStore(':memory:');
  const out = new FakeOutbox();
  const world = new World({ now: clock.now, store, out });
  return { clock, store, out, world };
}
const LOUNGE = { x: 11, z: 20 }; // open floor in the lounge
const CORRIDOR = { x: 14.5, z: 20 }; // spawn is in the corridor (x 13..16)

describe('World movement', () => {
  test('valid move updates position and next tick snapshot contains only movers', () => {
    const { world, out, clock } = setup();
    world.join('a', prof('A', '가나다'));
    world.join('b', prof('B', '라마바'));
    clock.advance(1000);
    world.move('a', MAP.spawn.x, MAP.spawn.z - 1, 1.5);
    expect(world.view('a')).toMatchObject({ x: MAP.spawn.x, z: MAP.spawn.z - 1, ry: 1.5 });
    world.tick();
    const snaps = out.find('toAll', 'snapshot');
    expect(snaps).toHaveLength(1);
    expect(snaps[0].args[0]).toEqual({ t: clock.now(), moved: [{ id: 'a', x: MAP.spawn.x, z: MAP.spawn.z - 1, ry: 1.5 }] });
    world.tick();
    expect(out.find('toAll', 'snapshot')).toHaveLength(1);
  });

  test('no movement → tick sends no snapshot', () => {
    const { world, out } = setup();
    world.join('a', prof('A', '가나다'));
    world.tick();
    expect(out.find('toAll', 'snapshot')).toHaveLength(0);
  });

  test('teleport or into-wall or outside-building move is rejected with correct to last valid position', () => {
    const { world, out, clock } = setup();
    world.join('a', prof('A', '가나다'));
    clock.advance(1000); // allows 4*1*1.5+0.5 = 6.5 m
    world.move('a', 2, 2, 0); // far teleport
    world.move('a', MAP.spawn.x, 24.2, 0); // outside the building
    world.move('a', 0.05, 23, 0); // inside the west wall
    world.move('a', Number.NaN, 20, 0);
    const corr = out.find('toPlayer', 'correct');
    expect(corr).toHaveLength(4);
    for (const c of corr) {
      expect(c.id).toBe('a');
      expect(c.args[0]).toEqual({ x: MAP.spawn.x, z: MAP.spawn.z });
    }
    expect(world.view('a')).toMatchObject({ x: MAP.spawn.x, z: MAP.spawn.z });
    world.tick();
    expect(out.find('toAll', 'snapshot')).toHaveLength(0);
  });

  test('dt is measured from the last accepted move, not the last rejected one', () => {
    const { world, out, clock } = setup();
    world.join('a', prof('A', '가나다'));
    clock.advance(100);
    world.move('a', 14.5, 18, 0); // 5m in 0.1s: rejected
    expect(out.find('toPlayer', 'correct')).toHaveLength(1);
    clock.advance(2000);
    world.move('a', 14.5, 18, 0); // 2.1s since join: allowed (limit 13.1m)
    expect(world.view('a')).toMatchObject({ x: 14.5, z: 18 });
    expect(out.find('toPlayer', 'correct')).toHaveLength(1);
  });

  test('sit through a wall is rejected (player zone must equal seat zone)', () => {
    const { world, clock } = setup();
    world.join('a', prof('A', '가나다'));
    moveAfter(world, clock, 'a', 24.5, 13.5, 0); // reading side of the z=14 wall
    expect(world.view('a')!.zone).toBe('reading');
    const a1 = seatById('A1')!; // study room A, just behind the wall
    expect(Math.hypot(a1.x - 24.5, a1.z - 13.5)).toBeLessThanOrEqual(INTERACT_RANGE + 0.5); // close enough by distance
    expect(world.sit('a', 'A1')).toEqual({ ok: false, reason: 'far' });
    expect(world.view('a')!.seatId).toBeNull();
  });

  test('move while seated is ignored', () => {
    const { world, out, clock } = setup();
    world.join('a', prof('A', '가나다'));
    moveAfter(world, clock, 'a', 18.8, 3.4, 0);
    expect(world.sit('a', 'R01')).toEqual({ ok: true });
    const before = world.view('a')!;
    out.calls.length = 0;
    moveAfter(world, clock, 'a', 20, 8, 0);
    expect(world.view('a')).toEqual(before);
    expect(out.calls).toHaveLength(0);
  });

  test('entering lounge sets break endsAt = now + 10min; with setBreakMinutes(5) → 5min; leaving clears', () => {
    const { world, clock } = setup();
    world.join('a', prof('A', '가나다'));
    moveAfter(world, clock, 'a', LOUNGE.x, LOUNGE.z);
    expect(world.view('a')!.status).toEqual({ kind: 'break', endsAt: clock.now() + 10 * 60000 });
    moveAfter(world, clock, 'a', CORRIDOR.x, CORRIDOR.z);
    expect(world.view('a')!.status).toEqual({ kind: 'none' });
    world.setBreakMinutes('a', 5);
    moveAfter(world, clock, 'a', LOUNGE.x, LOUNGE.z);
    expect(world.view('a')!.status).toEqual({ kind: 'break', endsAt: clock.now() + 5 * 60000 });
  });

  test('setBreakMinutes while on break restarts the break and broadcasts; invalid values ignored', () => {
    const { world, out, clock } = setup();
    world.join('a', prof('A', '가나다'));
    moveAfter(world, clock, 'a', LOUNGE.x, LOUNGE.z);
    clock.advance(60_000);
    out.calls.length = 0;
    world.setBreakMinutes('a', 15);
    expect(world.view('a')!.status).toEqual({ kind: 'break', endsAt: clock.now() + 15 * 60000 });
    expect(out.find('toAll', 'playerUpdated')).toHaveLength(1);
    out.calls.length = 0;
    world.setBreakMinutes('a', 7 as 5);
    expect(world.view('a')!.status).toEqual({ kind: 'break', endsAt: clock.now() + 15 * 60000 });
    expect(out.calls).toHaveLength(0);
  });

  test('sitting on a lounge sofa and standing up keep the break', () => {
    const { world, clock } = setup();
    world.join('a', prof('A', '가나다'));
    moveAfter(world, clock, 'a', 4.5, 10.5);
    const status = world.view('a')!.status;
    expect(status.kind).toBe('break');
    expect(world.sit('a', 'S1')).toEqual({ ok: true });
    expect(world.view('a')!.status).toEqual(status);
    world.stand('a');
    expect(world.view('a')!.status).toEqual(status);
  });

  test('zone change calls setRoom with main:<zone> and emits playerUpdated', () => {
    const { world, out, clock } = setup();
    world.join('a', prof('A', '가나다'));
    expect(out.find('setRoom', 'setRoom').at(-1)).toMatchObject({ id: 'a', args: ['main:corridor'] });
    out.calls.length = 0;
    moveAfter(world, clock, 'a', 14.5, 22); // same zone: nothing
    expect(out.find('setRoom', 'setRoom')).toHaveLength(0);
    expect(out.find('toAll', 'playerUpdated')).toHaveLength(0);
    moveAfter(world, clock, 'a', LOUNGE.x, LOUNGE.z);
    expect(out.find('setRoom', 'setRoom').at(-1)!.args).toEqual(['main:lounge']);
    const upd = out.find('toAll', 'playerUpdated');
    expect(upd).toHaveLength(1);
    expect(upd[0].args[0]).toMatchObject({ id: 'a', zone: 'lounge' });
  });

  test('reconnect with same anonId succeeds at capacity (stale ghost is replaced before the capacity check)', () => {
    const { world, out } = setup();
    for (let i = 0; i < BUILDING_CAPACITY; i++) world.join(`c${i}`, prof(`U${i}`, `user${i}`));
    const r = world.join('fresh', prof('U0', 'user0'));
    expect(r.ok).toBe(true);
    expect(out.calls.some((c) => c.kind === 'kick' && c.id === 'c0')).toBe(true);
    expect(world.realCount()).toBe(BUILDING_CAPACITY);
    expect(world.join('other', prof('Z', '다른사람'))).toEqual({ ok: false, reason: 'full' });
  });
});

describe('World today stats', () => {
  function seat(world: World, clock: ReturnType<typeof fakeClock>, id: string, anon: string, nick: string) {
    world.join(id, prof(anon, nick));
    moveAfter(world, clock, id, 18.8, 3.4, 0);
    expect(world.sit(id, 'R01')).toEqual({ ok: true });
  }

  test('today stats include live sessions and are broadcast only when changed', () => {
    const { world, store, out, clock } = setup(Date.UTC(2026, 10, 5, 3, 0, 0)); // 12:00 KST
    seat(world, clock, 'a', 'A', '공부왕');
    const sitAt = clock.now();
    clock.set(sitAt - 5000);
    world.tick();
    expect(out.find('toAll', 'today')).toHaveLength(0); // 5s since creation < 10s
    clock.set(sitAt + 60_000);
    world.tick();
    const t1 = out.find('toAll', 'today');
    expect(t1).toHaveLength(1);
    expect(t1[0].args[0]).toEqual({ dayKey: kstDayKey(clock.now()), people: 1, totalSec: 60, top5: [{ nickname: '공부왕', sec: 60 }] });
    clock.advance(TODAY_BROADCAST_MS);
    world.tick(); // changed (+10s)
    expect(out.find('toAll', 'today')).toHaveLength(2);
    const j = world.join('c', prof('C', '새사람'));
    expect(j.ok && j.today).toEqual({ dayKey: kstDayKey(clock.now()), people: 1, totalSec: 70, top5: [{ nickname: '공부왕', sec: 70 }] });
    world.stand('a'); // session saved at 70s; live value now identical to stored value
    clock.advance(TODAY_BROADCAST_MS);
    world.tick();
    expect(out.find('toAll', 'today')).toHaveLength(2); // unchanged → not rebroadcast
    expect(store.userDaySec('A', kstDayKey(clock.now()))).toBe(70);
  });

  test('today stats merge a live session with stored sessions of the same user', () => {
    const { world, store, clock } = setup(Date.UTC(2026, 10, 5, 3, 0, 0));
    store.upsertProfile('A', '공부왕');
    store.addSession({ anonId: 'A', buildingId: 'main', seatId: 'R02', startMs: clock.now() - 100_000, endMs: clock.now() - 40_000 });
    seat(world, clock, 'a', 'A', '공부왕');
    clock.advance(30_000);
    const j = world.join('c', prof('C', '새사람'));
    expect(j.ok && j.today).toMatchObject({ people: 1, totalSec: 60 + 30, top5: [{ nickname: '공부왕', sec: 90 }] });
  });

  test('hidden live user is counted in people/total but absent from top5 (stored=0 and stored>0)', () => {
    const { world, store, clock } = setup(Date.UTC(2026, 10, 5, 3, 0, 0));
    store.upsertProfile('A', '숨은이');
    store.upsertProfile('B', '보이는이');
    store.addSession({ anonId: 'B', buildingId: 'main', seatId: 'R02', startMs: clock.now() - 100_000, endMs: clock.now() - 40_000 });
    seat(world, clock, 'a', 'A', '숨은이');
    world.join('b', prof('B', '보이는이'));
    moveAfter(world, clock, 'b', 21.8, 3.4, 0);
    expect(world.sit('b', 'R02')).toEqual({ ok: true });
    store.setHidden('A', true); // flipped mid-session, e.g. by the admin CLI
    clock.advance(30_000);
    const j = world.join('c', prof('C', '새사람'));
    expect(j.ok && j.today).toMatchObject({ people: 2, top5: [{ nickname: '보이는이', sec: 90 }] });
    expect(j.ok && j.today.top5).toHaveLength(1);
    expect(j.ok && j.today.totalSec).toBeGreaterThan(90);
    // hidden user with stored > 0
    store.addSession({ anonId: 'A', buildingId: 'main', seatId: 'R03', startMs: clock.now() - 500_000, endMs: clock.now() - 400_000 });
    const k = world.join('d', prof('D', '또새사람'));
    expect(k.ok && k.today.top5.map((e) => e.nickname)).toEqual(['보이는이']);
    expect(k.ok && k.today.people).toBe(2);
  });

  test('a non-hidden user literally named 익명 appears in top5', () => {
    const { world, clock } = setup(Date.UTC(2026, 10, 5, 3, 0, 0));
    seat(world, clock, 'a', 'A', '익명');
    clock.advance(30_000);
    const j = world.join('c', prof('C', '새사람'));
    expect(j.ok && j.today.top5).toEqual([{ nickname: '익명', sec: 30 }]);
  });

  test('today stats count only today part of a live session that started yesterday (KST)', () => {
    // 23:59:00 KST on Nov 4 == 14:59:00 UTC
    const { world, clock } = setup(Date.UTC(2026, 10, 4, 14, 59, 0));
    seat(world, clock, 'a', 'A', '공부왕'); // sits 10s after join: 23:59:10
    clock.set(Date.UTC(2026, 10, 4, 15, 0, 30)); // 00:00:30 KST Nov 5
    const j = world.join('c', prof('C', '새사람'));
    expect(j.ok && j.today).toEqual({ dayKey: '2026-11-05', people: 1, totalSec: 30, top5: [{ nickname: '공부왕', sec: 30 }] });
  });
});

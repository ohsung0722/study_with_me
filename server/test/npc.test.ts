import { describe, expect, test } from 'vitest';
import { MAP, seatById, type Profile } from '@studyverse/shared';
import { World } from '../src/game/world';
import { NPC_SEATS, npcTarget } from '../src/game/npc';
import { openStore } from '../src/store/store';
import { FakeOutbox, fakeClock, moveAfter } from './helpers';

const prof = (anonId: string, nickname = '공부왕'): Profile => ({
  anonId, nickname, breakMinutes: 10,
  appearance: { hair: 'short', hairColor: '#000000', shirtColor: '#3366ff' },
});

function setup() {
  const clock = fakeClock(1_000_000);
  const store = openStore(':memory:');
  const out = new FakeOutbox();
  const world = new World({ now: clock.now, store, out, rand: () => 0.5 });
  return { clock, store, out, world };
}

describe('npc mates', () => {
  test('npcTarget table', () => { expect([0, 1, 2, 3, 10].map(npcTarget)).toEqual([3, 3, 2, 0, 0]); });

  test('NPC seats are distinct desks in the reading-room row farthest from its door (x=16, z10–12)', () => {
    const desks = MAP.seats.filter((s) => s.kind === 'desk');
    const backZ = Math.min(...desks.map((s) => s.z));
    expect(new Set(NPC_SEATS).size).toBe(NPC_SEATS.length);
    for (const id of NPC_SEATS) {
      const s = seatById(id)!;
      expect(s.kind).toBe('desk');
      expect(s.z).toBe(backZ);
      expect(Math.hypot(s.x - 16, s.z - 11)).toBeGreaterThan(8);
    }
  });

  test('world adds 3 npcs on first tick with 1 real player, all focused at NPC_SEATS', () => {
    const { world, out, clock } = setup();
    world.join('a', prof('A'));
    world.tick();
    const joined = out.find('toAll', 'playerJoined').map((c) => c.args[0] as any);
    expect(joined.map((v) => v.id)).toEqual(['npc-1', 'npc-2', 'npc-3']);
    joined.forEach((v, i) => {
      expect(v).toMatchObject({ nickname: '메이트', isNpc: true, seatId: NPC_SEATS[i], zone: 'reading', drink: null });
      expect(v.status).toMatchObject({ kind: 'studying', focus: true });
      const mins = (clock.now() - v.status.startedAt) / 60000;
      expect(mins).toBeGreaterThanOrEqual(20); expect(mins).toBeLessThanOrEqual(90);
      expect(v.ry).toBe(seatById(NPC_SEATS[i])!.facing);
    });
    expect(world.realCount()).toBe(1);
    world.tick();
    expect(out.find('toAll', 'playerJoined')).toHaveLength(3);
  });

  test('third real player joining → next tick removes all npcs with playerLeft npc:true, highest index first', () => {
    const { world, out } = setup();
    world.join('a', prof('A')); world.join('b', prof('B'));
    world.tick();
    expect(out.find('toAll', 'playerJoined')).toHaveLength(2);
    world.join('c', prof('C'));
    world.tick();
    expect(out.find('toAll', 'playerLeft').map((c) => c.args[0])).toEqual([
      { id: 'npc-2', npc: true }, { id: 'npc-1', npc: true },
    ]);
    expect(world.view('npc-1')).toBeUndefined();
  });

  test('npcs never appear in todayStats or store, and are not greet targets', () => {
    const { world, store, clock } = setup();
    world.join('a', prof('A'));
    world.tick();
    clock.advance(60_000);
    expect(world.greet('a')).toEqual({ ok: false, reason: 'noTarget' });
    const j = world.join('b', prof('B'));
    expect(j.ok && j.today.people).toBe(0);
    expect(j.ok && j.today.top5).toEqual([]);
    world.shutdown();
    expect(store.todayStats('x', 'main').totalSec).toBe(0);
  });

  test('join ack players list includes current npcs; real player cannot sit on npc seat', () => {
    const { world } = setup();
    world.join('a', prof('A'));
    world.tick();
    const j = world.join('b', prof('B'));
    expect(j.ok && j.players.filter((p) => p.isNpc).map((p) => p.id)).toEqual(['npc-1', 'npc-2', 'npc-3']);
    expect(world.sit('b', NPC_SEATS[0])).toEqual({ ok: false, reason: 'taken' });
  });

  test('npc takes the highest free desk when its seat is held by a real player', () => {
    const { world, clock } = setup();
    world.join('a', prof('A'));
    const s = seatById('R06')!; // npc-1's seat
    moveAfter(world, clock, 'a', s.x, s.z + 1, 0);
    expect(world.sit('a', 'R06')).toEqual({ ok: true });
    world.tick();
    expect(world.view('npc-1')!.seatId).toBe('R48'); // the highest free desk id (east reading room)
    expect(world.view('npc-2')!.seatId).toBe('R04'); // its own seat is still free
  });
});

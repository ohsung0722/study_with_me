import { describe, expect, test } from 'vitest';
import { seatById, type Profile } from '@studyverse/shared';
import { World } from '../src/game/world';
import { openStore } from '../src/store/store';
import { FakeOutbox, fakeClock, moveAfter } from './helpers';

const prof = (anonId: string): Profile => ({
  anonId, nickname: '공부왕', breakMinutes: 10,
  appearance: { hair: 'short', hairColor: '#000000', shirtColor: '#3366ff' },
});

describe('World.seatTodaySec', () => {
  test('stored + live part of the current occupant; 0 for unknown ids', () => {
    const clock = fakeClock(1_800_000_000_000);
    const world = new World({ now: clock.now, store: openStore(':memory:'), out: new FakeOutbox() });
    const s = seatById('R01')!;
    expect(world.seatTodaySec('R01')).toBe(0);
    expect(world.seatTodaySec('nope')).toBe(0);
    world.join('a', prof('A'));
    const t0 = clock.now();
    moveAfter(world, clock, 'a', s.x, s.z + 1, 0);
    clock.set(t0);
    expect(world.sit('a', 'R01')).toEqual({ ok: true });
    clock.advance(60_000);
    expect(world.seatTodaySec('R01')).toBe(60);
    world.stand('a');
    clock.advance(30_000);
    expect(world.seatTodaySec('R01')).toBe(60);
  });

  test('NPC seats are 0', () => {
    const clock = fakeClock(1_800_000_000_000);
    const world = new World({ now: clock.now, store: openStore(':memory:'), out: new FakeOutbox() });
    world.tick();
    clock.advance(60_000);
    for (const id of ['R01', 'R02', 'R03', 'R04', 'R05', 'R06']) expect(world.seatTodaySec(id)).toBe(0);
  });
});

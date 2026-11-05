import { describe, expect, test } from 'vitest';
import { DRINK_LIFETIME_MS, type Profile } from '@studyverse/shared';
import { World } from '../src/game/world';
import { openStore } from '../src/store/store';
import { FakeOutbox, fakeClock, moveAfter } from './helpers';

const prof = (anonId: string, nickname: string): Profile => ({
  anonId, nickname, breakMinutes: 10, appearance: { hair: 'short', hairColor: '#000000', shirtColor: '#3366ff' },
});
function setup() {
  const clock = fakeClock(0);
  const out = new FakeOutbox();
  const world = new World({ now: clock.now, store: openStore(':memory:'), out });
  const add = (id: string, nick: string, x: number, z: number) => {
    world.join(id, prof(id, nick));
    moveAfter(world, clock, id, x, z);
  };
  return { clock, out, world, add };
}

describe('greetings', () => {
  test('greet broadcasts wave and sends greeted only to target', () => {
    const { world, out, add } = setup();
    add('a', '가나다', 5, 5); add('b', '라마바', 5.8, 5);
    expect(world.greet('a')).toEqual({ ok: true, targetId: 'b' });
    expect(out.find('toAll', 'wave').map((c) => c.args[0])).toEqual([{ id: 'a' }]);
    const g = out.find('toPlayer', 'greeted');
    expect(g).toHaveLength(1);
    expect(g[0].id).toBe('b');
    expect(g[0].args[0]).toEqual({ fromId: 'a', fromNick: '가나다' });
  });

  test('first greet is not blocked at clock 0; noTarget does not start cooldown; success does', () => {
    const { world, clock, add } = setup();
    add('a', '가나다', 5, 5);
    expect(world.greet('a')).toEqual({ ok: false, reason: 'noTarget' });
    add('b', '라마바', 5.8, 5);
    expect(world.greet('a')).toMatchObject({ ok: true });
    expect(world.greet('a')).toEqual({ ok: false, reason: 'cooldown' });
    clock.advance(5000);
    expect(world.greet('a')).toMatchObject({ ok: true });
  });

  test('greetAccept within 5s waves acceptor; after 5s or from non-greeter does nothing', () => {
    const { world, clock, out, add } = setup();
    add('a', '가나다', 5, 5); add('b', '라마바', 5.8, 5); add('c', '사아자', 5, 5.8);
    world.greet('a');
    const waves = () => out.find('toAll', 'wave').length;
    expect(waves()).toBe(1);
    world.greetAccept('b', 'c'); // not the greeter
    world.greetAccept('c', 'a'); // c was not greeted
    expect(waves()).toBe(1);
    clock.advance(5000);
    world.greetAccept('b', 'a');
    expect(waves()).toBe(2);
    expect(out.find('toAll', 'wave')[1].args[0]).toEqual({ id: 'b' });
    world.greetAccept('b', 'a'); // consumed
    expect(waves()).toBe(2);
    // expired
    clock.advance(10000);
    world.greet('a');
    clock.advance(5001);
    world.greetAccept('b', 'a');
    expect(waves()).toBe(3);
  });
});

describe('drinks', () => {
  test('drink near coffee machine ok; latte at vending fails; far away fails; expires after 10min', () => {
    const { world, clock, out, add } = setup();
    add('a', '가나다', 2.2, 3);
    expect(world.takeDrink('a', 'latte')).toBe(true);
    expect(world.view('a')!.drink).toEqual({ id: 'latte', until: clock.now() + DRINK_LIFETIME_MS });
    expect(out.find('toAll', 'playerUpdated').pop()!.args[0]).toMatchObject({ id: 'a', drink: { id: 'latte' } });
    expect(world.takeDrink('a', 'greenTea')).toBe(false); // vending is 3m away
    expect(world.takeDrink('a', 'nope' as any)).toBe(false);
    add('b', '라마바', 8, 8);
    expect(world.takeDrink('b', 'americano')).toBe(false);
    const n = out.find('toAll', 'playerUpdated').length;
    const until = world.view('a')!.drink!.until;
    clock.set(until - 1);
    world.tick();
    expect(world.view('a')!.drink).not.toBeNull();
    clock.set(until);
    world.tick();
    expect(world.view('a')!.drink).toBeNull();
    expect(out.find('toAll', 'playerUpdated').length).toBe(n + 1);
    expect(out.find('toAll', 'playerUpdated').pop()!.args[0]).toMatchObject({ id: 'a', drink: null });
  });
});

describe('fix wave: drink range and greetAccept focus guard', () => {
  test('takeDrink allows the same +0.5m slack as sit (client prompt range + latency)', () => {
    const { world, add } = setup();
    add('a', '가나다', 2.9, 3); // 1.9m from the coffee machine at (1, 3)
    expect(world.takeDrink('a', 'americano')).toBe(true);
    add('b', '라마바', 3.1, 3); // 2.1m
    expect(world.takeDrink('b', 'americano')).toBe(false);
  });

  test('greetAccept does nothing while the accepter studies with focus', () => {
    const { world, out, add } = setup();
    add('b', '라마바', 18.6, 3.2); add('a', '가나다', 19.6, 3.2);
    expect(world.greet('a')).toEqual({ ok: true, targetId: 'b' });
    expect(world.sit('b', 'R01')).toEqual({ ok: true }); // desk → focus
    world.greetAccept('b', 'a');
    expect(out.find('toAll', 'wave')).toHaveLength(1);
  });
});

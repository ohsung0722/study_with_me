import { describe, expect, test } from 'vitest';
import { GREET_TOAST_MS } from '@studyverse/shared';
import { PendingGreet } from '../src/game/social';

describe('PendingGreet', () => {
  test('empty by default', () => expect(new PendingGreet().get(0)).toBeNull());
  test('holds the sender for GREET_TOAST_MS, then expires', () => {
    const p = new PendingGreet();
    p.set('a', 1000);
    expect(p.get(1000 + GREET_TOAST_MS - 1)).toBe('a');
    expect(p.get(1000 + GREET_TOAST_MS)).toBeNull();
  });
  test('a newer greeting replaces the older one', () => {
    const p = new PendingGreet();
    p.set('a', 0);
    p.set('b', 3000);
    expect(p.get(6000)).toBe('b');
  });
  test('take() returns the live sender once and clears it; only if it matches when an id is given', () => {
    const p = new PendingGreet();
    p.set('a', 0);
    expect(p.take(10, 'x')).toBeNull();
    expect(p.take(10, 'a')).toBe('a');
    expect(p.get(10)).toBeNull();
    p.set('b', 0);
    expect(p.take(GREET_TOAST_MS + 1)).toBeNull(); // expired
  });
  test('forget(id) drops a pending greeting from a player who left', () => {
    const p = new PendingGreet();
    p.set('a', 0);
    p.forget('b');
    expect(p.get(1)).toBe('a');
    p.forget('a');
    expect(p.get(1)).toBeNull();
  });
});

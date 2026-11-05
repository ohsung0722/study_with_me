// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { DEFAULT_BREAK_MINUTES, type Profile } from '@studyverse/shared';
import { DEFAULT_APPEARANCE, loadProfile, newAnonId, saveProfile } from '../src/profile';

const p: Profile = { anonId: 'a1', nickname: '민수', appearance: { hair: 'bun', hairColor: '#111111', shirtColor: '#222222' }, breakMinutes: 10 };

describe('profile', () => {
  test('save/load roundtrip; corrupt json → null', () => {
    const s = window.localStorage;
    s.clear();
    expect(loadProfile(s)).toBeNull();
    saveProfile(s, p);
    expect(loadProfile(s)).toEqual(p);
    s.setItem('studyverse.profile.v1', '{not json');
    expect(loadProfile(s)).toBeNull();
  });
  test('newAnonId returns distinct ids', () => {
    expect(newAnonId()).not.toBe(newAnonId());
  });
});

describe('loadProfile falls back to defaults for invalid stored fields', () => {
  const put = (v: unknown) => { window.localStorage.setItem('studyverse.profile.v1', JSON.stringify(v)); };
  test('bad hair / colors / breakMinutes → defaults, good fields kept', () => {
    put({ anonId: 'a1', nickname: '민수', appearance: { hair: 'mohawk', hairColor: 'red', shirtColor: '#12345' }, breakMinutes: 7 });
    expect(loadProfile(window.localStorage)).toEqual({
      anonId: 'a1', nickname: '민수', appearance: { ...DEFAULT_APPEARANCE }, breakMinutes: DEFAULT_BREAK_MINUTES,
    });
    put({ anonId: 'a1', nickname: '민수', appearance: { hair: 'long', hairColor: '#ABCDEF', shirtColor: 5 }, breakMinutes: 15 });
    expect(loadProfile(window.localStorage)).toEqual({
      anonId: 'a1', nickname: '민수', appearance: { hair: 'long', hairColor: '#ABCDEF', shirtColor: DEFAULT_APPEARANCE.shirtColor }, breakMinutes: 15,
    });
  });
  test('missing appearance, bad nickname or bad anonId are repaired, not rejected', () => {
    put({ anonId: '', nickname: 3 });
    const p = loadProfile(window.localStorage)!;
    expect(p.anonId).toMatch(/.+/);
    expect(p.nickname).toBe('');
    expect(p.appearance).toEqual(DEFAULT_APPEARANCE);
    expect(p.breakMinutes).toBe(DEFAULT_BREAK_MINUTES);
    put([1, 2]);
    expect(loadProfile(window.localStorage)).toBeNull();
    put('x'.repeat(5));
    expect(loadProfile(window.localStorage)).toBeNull();
  });
});

test('default appearance uses the entry screen\'s first swatches', async () => {
  const { HAIR_COLORS, SHIRT_COLORS } = await import('../src/ui/entry');
  expect(DEFAULT_APPEARANCE).toEqual({ hair: 'short', hairColor: HAIR_COLORS[0], shirtColor: SHIRT_COLORS[0] });
});

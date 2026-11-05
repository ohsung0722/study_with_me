// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import type { Profile } from '@studyverse/shared';
import { loadProfile, newAnonId, saveProfile } from '../src/profile';

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

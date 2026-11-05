import type { Profile } from '@studyverse/shared';

const KEY = 'studyverse.profile.v1';

export function loadProfile(storage: Storage): Profile | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object' || typeof p.anonId !== 'string' || typeof p.nickname !== 'string' || !p.appearance) return null;
    return p as Profile;
  } catch {
    return null;
  }
}

export function saveProfile(storage: Storage, p: Profile): void {
  try {
    storage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

export function newAnonId(): string {
  return crypto.randomUUID();
}

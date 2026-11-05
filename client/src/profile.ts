import { BREAK_MINUTES_OPTIONS, DEFAULT_BREAK_MINUTES, HAIR_STYLES, type Profile } from '@studyverse/shared';

const KEY = 'studyverse.profile.v1';
const HEX = /^#[0-9a-fA-F]{6}$/;

/** First choices of the entry screen; also the fallback for broken stored values. */
export const DEFAULT_APPEARANCE: Profile['appearance'] = { hair: 'short', hairColor: '#3b2a20', shirtColor: '#e8837a' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The saved profile, or null when there is none. Invalid fields (edited or old storage) fall back to defaults,
 * so the server never rejects a join for something the entry screen cannot show or fix.
 */
export function loadProfile(storage: Storage): Profile | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const p: unknown = JSON.parse(raw);
    if (!isObj(p)) return null;
    const a = isObj(p.appearance) ? p.appearance : {};
    const bm = p.breakMinutes;
    return {
      anonId: typeof p.anonId === 'string' && p.anonId.length > 0 && p.anonId.length <= 100 ? p.anonId : newAnonId(),
      nickname: typeof p.nickname === 'string' ? p.nickname : '',
      appearance: {
        hair: (HAIR_STYLES as readonly unknown[]).includes(a.hair) ? (a.hair as Profile['appearance']['hair']) : DEFAULT_APPEARANCE.hair,
        hairColor: typeof a.hairColor === 'string' && HEX.test(a.hairColor) ? a.hairColor : DEFAULT_APPEARANCE.hairColor,
        shirtColor: typeof a.shirtColor === 'string' && HEX.test(a.shirtColor) ? a.shirtColor : DEFAULT_APPEARANCE.shirtColor,
      },
      breakMinutes: (BREAK_MINUTES_OPTIONS as readonly unknown[]).includes(bm) ? (bm as Profile['breakMinutes']) : DEFAULT_BREAK_MINUTES,
    };
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

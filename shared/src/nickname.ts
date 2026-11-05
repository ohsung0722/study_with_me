import { NICK_MIN, NICK_MAX } from './constants';

// Short default list (lower-case, no spaces). Compared after stripping
// whitespace/special characters and lower-casing, by substring match.
export const BANNED_WORDS: readonly string[] = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'pussy', 'slut', 'whore', 'cunt',
  '씨발', '시발', '개새끼', '병신', '지랄', '좆', '염병', '썅', '미친놈', '느금마',
];
export const BANNED_SAMPLE: string = BANNED_WORDS[0];

// Control characters and bidi embeddings/overrides/isolates are never allowed.
const FORBIDDEN = /[\p{Cc}‪-‮⁦-⁩]/u;
// Characters that render as nothing: whitespace, format chars (zero-width…), Hangul fillers, braille blank.
const INVISIBLE = /[\p{White_Space}\p{Cf}ㅤᅟᅠﾠ⠀]/gu;

function normalize(s: string): string {
  return s.replace(INVISIBLE, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function validateNickname(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: 'length' | 'banned' } {
  const value = raw.normalize('NFC').trim();
  const len = [...value].length;
  if (len < NICK_MIN || len > NICK_MAX) return { ok: false, reason: 'length' };
  if (value.replace(INVISIBLE, '').length === 0) return { ok: false, reason: 'length' }; // nothing visible
  if (FORBIDDEN.test(value)) return { ok: false, reason: 'banned' };
  const n = normalize(value);
  if (BANNED_WORDS.some((w) => n.includes(w))) return { ok: false, reason: 'banned' };
  return { ok: true, value };
}

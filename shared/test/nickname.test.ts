import { expect, test } from 'vitest';
import { validateNickname, BANNED_SAMPLE } from '../src/index';

test('trims and accepts 2..12 code points', () => {
  expect(validateNickname('  공부왕  ')).toEqual({ ok: true, value: '공부왕' });
  expect(validateNickname('가')).toEqual({ ok: false, reason: 'length' });
  expect(validateNickname('가'.repeat(13))).toEqual({ ok: false, reason: 'length' });
  expect(validateNickname('   ')).toEqual({ ok: false, reason: 'length' });
});
test('emoji counts by code point', () => { expect(validateNickname('📚📚').ok).toBe(true); });
test('HTML-looking names are allowed as plain text', () => {
  expect(validateNickname('<b>hi</b>')).toEqual({ ok: true, value: '<b>hi</b>' });
});
test('banned words are rejected even with spacing', () => {
  expect(validateNickname(`a ${BANNED_SAMPLE.split('').join(' ')}`)).toEqual({ ok: false, reason: 'banned' });
});
test('invisible-only names are rejected (fillers, zero-width, braille blank)', () => {
  for (const s of ['ㅤㅤ', '​​', '⠀⠀', 'ᅟᅠ', 'ﾠﾠ', '　　', '​ㅤ ']) {
    expect(validateNickname(s)).toEqual({ ok: false, reason: 'length' });
  }
});
test('control and bidi characters are rejected', () => {
  for (const s of ['a‮b', 'ab⁦c', 'a\nb', 'a\tb', 'a\u0007b']) {
    expect(validateNickname(s).ok).toBe(false);
  }
});
test('visible names with one invisible char still pass; result is NFC', () => {
  expect(validateNickname('가​')).toEqual({ ok: true, value: '가​' });
  expect(validateNickname('공부'.normalize('NFD'))).toEqual({ ok: true, value: '공부' });
  expect(validateNickname('👨‍👩‍👧')).toMatchObject({ ok: true });
});
test('banned words are matched after NFC and with fillers stripped', () => {
  expect(validateNickname('시발'.normalize('NFD'))).toEqual({ ok: false, reason: 'banned' });
  expect(validateNickname('시ㅤ발')).toEqual({ ok: false, reason: 'banned' });
  expect(validateNickname('f​uck')).toEqual({ ok: false, reason: 'banned' });
});

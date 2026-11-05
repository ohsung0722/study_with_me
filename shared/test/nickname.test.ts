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

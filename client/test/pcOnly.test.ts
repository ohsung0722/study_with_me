import { describe, expect, test } from 'vitest';
import { isPcLike } from '../src/ui/pcOnly';

const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const androidTablet = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/120 Safari/537.36';

describe('isPcLike', () => {
  test('desktop Chrome true; iPhone UA false; Android tablet with touch & no fine pointer false', () => {
    expect(isPcLike(chrome, 0, true)).toBe(true);
    expect(isPcLike(iphone, 5, false)).toBe(false);
    expect(isPcLike(androidTablet, 5, false)).toBe(false);
  });
  test('touch laptop with fine pointer stays true', () => {
    expect(isPcLike(chrome, 10, true)).toBe(true);
  });
});

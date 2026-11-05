import { describe, expect, test } from 'vitest';
import { THEME_FADE_MS } from '@studyverse/shared';
import { DAY, NIGHT, ThemeBlender, lerpTheme, themeForHour } from '../src/three/theme';

describe('theme', () => {
  test('DAY/NIGHT use the approved mockup values (THEMES.warm / THEMES.night)', () => {
    expect(DAY).toEqual({ bg: 0x3a2618, floor: 0x7a4f2a, wall: 0xd8bf98, desk: 0xb07a43, part: 0x6b4423,
      ambC: 0xffe2b8, ambI: 0.45, keyC: 0xffd49a, keyI: 0.9, lamp: 0xffb45c, lampI: 2.2, win: 0xffe6a8, rain: 0 });
    expect(NIGHT).toEqual({ bg: 0x0a0f1e, floor: 0x1a2136, wall: 0x222a44, desk: 0x3b4060, part: 0x2a3152,
      ambC: 0x5a6aa8, ambI: 0.22, keyC: 0x6f7fff, keyI: 0.2, lamp: 0xffbf6b, lampI: 3.2, win: 0x18285a, rain: 1 });
  });

  test('themeForHour: 7..18 DAY, else NIGHT', () => {
    for (let h = 0; h < 24; h++) {
      expect(themeForHour(h)).toBe(h >= 7 && h <= 18 ? DAY : NIGHT);
    }
  });

  test('lerpTheme endpoints equal inputs', () => {
    expect(lerpTheme(DAY, NIGHT, 0)).toEqual(DAY);
    expect(lerpTheme(DAY, NIGHT, 1)).toEqual(NIGHT);
    // out-of-range k is clamped
    expect(lerpTheme(DAY, NIGHT, -1)).toEqual(DAY);
    expect(lerpTheme(DAY, NIGHT, 2)).toEqual(NIGHT);
  });

  test('lerpTheme midpoint blends colour channels and numbers', () => {
    const mid = lerpTheme(DAY, NIGHT, 0.5);
    expect(mid.rain).toBeCloseTo(0.5);
    expect(mid.ambI).toBeCloseTo((0.45 + 0.22) / 2);
    // bg 0x3a2618 → 0x0a0f1e: r (0x3a+0x0a)/2=0x22, g (0x26+0x0f)/2=0x1a (26.5→ round 27 = 0x1b), b (0x18+0x1e)/2=0x1b
    expect(mid.bg).toBe(0x221b1b);
  });

  test('ThemeBlender fades to the target over THEME_FADE_MS', () => {
    const b = new ThemeBlender(DAY);
    expect(b.current()).toEqual(DAY);
    b.setTarget(NIGHT);
    expect(b.update(THEME_FADE_MS / 2)).toBe(true);
    expect(b.current().rain).toBeCloseTo(0.5);
    b.update(THEME_FADE_MS / 2);
    expect(b.current()).toEqual(NIGHT);
    expect(b.update(16)).toBe(false); // settled: nothing to apply
    b.setTarget(NIGHT); // same target → no fade
    expect(b.update(16)).toBe(false);
  });
});

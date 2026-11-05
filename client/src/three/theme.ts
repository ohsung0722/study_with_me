// Day/night themes. Values are the approved mockup's THEMES.warm (day) and THEMES.night (night).
import { THEME_FADE_MS, isNightHour } from '@studyverse/shared';

export interface Theme {
  bg: number; floor: number; wall: number; desk: number; part: number;
  ambC: number; ambI: number; keyC: number; keyI: number;
  lamp: number; lampI: number; win: number; rain: number;
}

export const DAY: Theme = {
  bg: 0x3a2618, floor: 0x7a4f2a, wall: 0xd8bf98, desk: 0xb07a43, part: 0x6b4423,
  ambC: 0xffe2b8, ambI: 0.45, keyC: 0xffd49a, keyI: 0.9, lamp: 0xffb45c, lampI: 2.2, win: 0xffe6a8, rain: 0,
};

export const NIGHT: Theme = {
  bg: 0x0a0f1e, floor: 0x1a2136, wall: 0x222a44, desk: 0x3b4060, part: 0x2a3152,
  ambC: 0x5a6aa8, ambI: 0.22, keyC: 0x6f7fff, keyI: 0.2, lamp: 0xffbf6b, lampI: 3.2, win: 0x18285a, rain: 1,
};

const COLOR_KEYS = ['bg', 'floor', 'wall', 'desk', 'part', 'ambC', 'keyC', 'lamp', 'win'] as const;
const NUM_KEYS = ['ambI', 'keyI', 'lampI', 'rain'] as const;

export function themeForHour(hour: number): Theme {
  return isNightHour(hour) ? NIGHT : DAY;
}

function lerpHex(a: number, b: number, k: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 0xff, cb = (b >> shift) & 0xff;
    out |= Math.round(ca * (1 - k) + cb * k) << shift;
  }
  return out;
}

/** Blend two themes; k is clamped to [0, 1]. Colours blend per 8-bit sRGB channel. */
export function lerpTheme(a: Theme, b: Theme, k: number): Theme {
  const t = Math.min(1, Math.max(0, k));
  const out = { ...a };
  for (const key of COLOR_KEYS) out[key] = lerpHex(a[key], b[key], t);
  for (const key of NUM_KEYS) out[key] = a[key] * (1 - t) + b[key] * t; // exact at both ends
  return out;
}

/** Linear fade from the current blend to a new target theme over `fadeMs`. */
export class ThemeBlender {
  private from: Theme;
  private to: Theme;
  private k = 1;
  private fadeMs = THEME_FADE_MS;
  private cur: Theme;

  constructor(initial: Theme) {
    this.from = initial;
    this.to = initial;
    this.cur = { ...initial };
  }

  current(): Theme {
    return this.cur;
  }

  setTarget(t: Theme, fadeMs = THEME_FADE_MS): void {
    if (t === this.to) return;
    this.from = { ...this.cur };
    this.to = t;
    this.fadeMs = fadeMs;
    this.k = 0;
  }

  /** Advance the fade; returns true when the current theme changed (re-apply it). */
  update(dtMs: number): boolean {
    if (this.k >= 1) return false;
    this.k = this.fadeMs > 0 ? Math.min(1, this.k + dtMs / this.fadeMs) : 1;
    this.cur = lerpTheme(this.from, this.to, this.k);
    return true;
  }
}

// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { StatsOverlay, formatStats, renderFps, statsEnabled, type StatsSample } from '../src/ui/stats';

const sample: StatsSample = { renderFps: 59.6, rafFps: 164.6, tickMs: 8.24, calls: 87, triangles: 123456, pixelRatio: 1.276, tier: 'high', lights: 6 };

describe('renderFps', () => {
  test('1000 / mean interval between rendered frames; 0 without intervals', () => {
    expect(renderFps(1000 / 60 * 30, 30)).toBeCloseTo(60);
    expect(renderFps(500, 10)).toBe(20);
    expect(renderFps(0, 0)).toBe(0);
  });
});

describe('stats overlay', () => {
  test('statsEnabled: only ?stats=1', () => {
    expect(statsEnabled('?stats=1')).toBe(true);
    expect(statsEnabled('?hour=22&stats=1')).toBe(true);
    expect(statsEnabled('')).toBe(false);
    expect(statsEnabled('?stats=0')).toBe(false);
    expect(statsEnabled('?stats')).toBe(false);
  });

  test('formatStats: one line per value, rounded; render fps vs rAF fps vs the controller tick sample', () => {
    expect(formatStats(sample)).toBe([
      'render fps 60',
      'raf fps 165',
      'tick 8.2 ms',
      'calls 87',
      'tris 123.5k',
      'ratio 1.28',
      'tier high',
      'lights 6',
    ].join('\n'));
  });

  test('StatsOverlay shows the formatted sample and removes itself', () => {
    const o = new StatsOverlay(document.body);
    o.show(sample);
    const el = document.querySelector('.stats-overlay');
    expect(el?.textContent).toBe(formatStats(sample));
    o.dispose();
    expect(document.querySelector('.stats-overlay')).toBeNull();
  });
});

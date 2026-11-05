// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { StatsOverlay, formatStats, statsEnabled, type StatsSample } from '../src/ui/stats';

const sample: StatsSample = { fps: 59.6, frameMs: 8.24, calls: 87, triangles: 123456, pixelRatio: 1.276, tier: 'high', lights: 6 };

describe('stats overlay', () => {
  test('statsEnabled: only ?stats=1', () => {
    expect(statsEnabled('?stats=1')).toBe(true);
    expect(statsEnabled('?hour=22&stats=1')).toBe(true);
    expect(statsEnabled('')).toBe(false);
    expect(statsEnabled('?stats=0')).toBe(false);
    expect(statsEnabled('?stats')).toBe(false);
  });

  test('formatStats: one line per value, rounded', () => {
    expect(formatStats(sample)).toBe([
      'fps 60',
      'frame 8.2 ms',
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

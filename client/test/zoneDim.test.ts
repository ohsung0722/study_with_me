import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { OTHER_ZONE_BRIGHTNESS, ZONE_FADE_MS } from '@studyverse/shared';
import { ZoneDimmer, zoneTargets } from '../src/three/zoneDim';

describe('zone dimming', () => {
  test('zoneTargets: corridor/null all 1; lounge → lounge 1 others 0.45', () => {
    const all1 = { lounge: 1, corridor: 1, reading: 1, studyA: 1, studyB: 1 };
    expect(zoneTargets('corridor')).toEqual(all1);
    expect(zoneTargets(null)).toEqual(all1);
    expect(zoneTargets('lounge')).toEqual({
      lounge: 1, corridor: OTHER_ZONE_BRIGHTNESS, reading: OTHER_ZONE_BRIGHTNESS,
      studyA: OTHER_ZONE_BRIGHTNESS, studyB: OTHER_ZONE_BRIGHTNESS,
    });
    expect(OTHER_ZONE_BRIGHTNESS).toBe(0.45);
  });

  test('ZoneDimmer reaches target after ZONE_FADE_MS', () => {
    const d = new ZoneDimmer();
    expect(d.factor('reading')).toBe(1);
    d.setZone('lounge');
    d.update(ZONE_FADE_MS / 2);
    expect(d.factor('reading')).toBeCloseTo((1 + OTHER_ZONE_BRIGHTNESS) / 2);
    expect(d.factor('lounge')).toBe(1);
    d.update(ZONE_FADE_MS / 2);
    expect(d.factor('reading')).toBe(OTHER_ZONE_BRIGHTNESS);
    d.update(1000);
    expect(d.factor('reading')).toBe(OTHER_ZONE_BRIGHTNESS); // no overshoot
    // back to the corridor: everything brightens back within one fade
    d.setZone('corridor');
    d.update(ZONE_FADE_MS);
    for (const z of ['lounge', 'corridor', 'reading', 'studyA', 'studyB'] as const) expect(d.factor(z)).toBe(1);
  });

  test('ZoneDimmer scales registered material colours from their base colour', () => {
    const d = new ZoneDimmer();
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff });
    d.register('reading', m);
    d.setZone('lounge');
    d.update(ZONE_FADE_MS);
    expect(m.color.r).toBeCloseTo(OTHER_ZONE_BRIGHTNESS);
    // a theme change sets a new base; the current dim factor still applies
    d.setBase(m, 0x000000);
    expect(m.color.r).toBe(0);
    d.setBase(m, 0xffffff);
    expect(m.color.g).toBeCloseTo(OTHER_ZONE_BRIGHTNESS);
  });
});

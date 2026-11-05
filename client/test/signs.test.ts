// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { MAP, zoneAt } from '@studyverse/shared';
import { buildSigns } from '../src/three/signs';
import { ZoneDimmer } from '../src/three/zoneDim';

// jsdom has no 2D canvas: the sign textures stay blank (and jsdom must not log "not implemented").
beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterAll(() => { vi.restoreAllMocks(); });

const center = (m: THREE.Mesh) => {
  m.geometry.computeBoundingBox();
  return m.geometry.boundingBox!.getCenter(new THREE.Vector3());
};

describe('room signs', () => {
  test('a name film on the hall side of every study room\'s and lounge\'s glass wall', () => {
    const root = new THREE.Group();
    buildSigns(root, new ZoneDimmer());
    for (const zone of ['studyA', 'studyB', 'studyC', 'studyD', 'lounge', 'cafe'] as const) {
      const film = root.getObjectByName(`sign:film:${zone}`) as THREE.Mesh;
      expect(film, zone).toBeDefined();
      const c = center(film);
      // just outside the room, in a hall, and within the room's width
      expect(['hallW', 'hallE']).toContain(zoneAt(c.x, c.z));
      expect(c.x).toBeGreaterThan(MAP.zones[zone].x1);
      expect(c.x).toBeLessThan(MAP.zones[zone].x2);
      expect(Math.abs(c.z - (zone.startsWith('study') ? MAP.zones[zone].z2 : MAP.zones[zone].z1))).toBeLessThan(0.15);
    }
  });

  test('three double-sided hanging signs over the main corridor, above head height', () => {
    const root = new THREE.Group();
    buildSigns(root, new ZoneDimmer());
    for (let i = 0; i < 3; i++) {
      for (const side of ['in', 'out']) {
        const face = root.getObjectByName(`sign:hang:${i}:${side}`) as THREE.Mesh;
        expect(face, `${i}:${side}`).toBeDefined();
        const c = center(face);
        expect(zoneAt(c.x, c.z)).toBe('corridor');
        expect(c.y).toBeGreaterThan(2.2);
      }
    }
    expect(root.getObjectByName('signBoards')).toBeDefined();
  });

  test('glow follows the night level', () => {
    const root = new THREE.Group();
    const signs = buildSigns(root, new ZoneDimmer());
    const mat = () => ((root.getObjectByName('sign:hang:0:in') as THREE.Mesh).material as THREE.MeshLambertMaterial).emissiveIntensity;
    signs.setNight(0);
    const day = mat();
    signs.setNight(1);
    expect(mat()).toBeGreaterThan(day);
  });
});

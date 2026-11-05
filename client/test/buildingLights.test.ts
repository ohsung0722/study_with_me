// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { OTHER_ZONE_BRIGHTNESS } from '@studyverse/shared';
import { buildBuilding, type Building } from '../src/three/building';
import { DAY, NIGHT } from '../src/three/theme';
import { ZoneDimmer } from '../src/three/zoneDim';

// jsdom has no 2D canvas; the glow gradient texture just stays blank (and jsdom must not log "not implemented").
beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterAll(() => { vi.restoreAllMocks(); });

const pointLights = (scene: THREE.Scene) => {
  const out: THREE.PointLight[] = [];
  scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight) out.push(o as THREE.PointLight); });
  return out;
};
const colourSum = (scene: THREE.Scene, name: string) => {
  const c = (scene.getObjectByName(name) as THREE.Mesh).geometry.getAttribute('color');
  let s = 0;
  for (let i = 0; i < c.count; i++) s += c.getX(i) + c.getY(i) + c.getZ(i);
  return s;
};
function settle(b: Building, dim: ZoneDimmer, focus: { x: number; z: number }, ms = 2000) {
  for (let t = 0; t < ms; t += 16) { dim.update(16); b.update(16, focus); }
}

describe('building lamps (light pool + glow)', () => {
  test('≤ 6 point lights, all visible, under DAY, NIGHT and a dimmed zone', () => {
    const scene = new THREE.Scene();
    const dim = new ZoneDimmer();
    const b = buildBuilding(scene, dim);
    const check = () => {
      const ls = pointLights(scene);
      expect(ls.length).toBeLessThanOrEqual(6);
      expect(ls.every((l) => l.visible)).toBe(true);
      return ls;
    };
    b.applyTheme(DAY);
    settle(b, dim, { x: 24, z: 6 }); // in the reading room
    expect(check().filter((l) => l.intensity > 0)).toHaveLength(6); // 24 desk lamps by day → the pool is full
    b.applyTheme(NIGHT);
    settle(b, dim, { x: 6, z: 12 }); // lounge
    check();
    dim.setZone('lounge');
    settle(b, dim, { x: 6, z: 12 });
    check();
  });

  test('NIGHT lounge: the lounge lamps take pool lights; by DAY the night-only lamps never do', () => {
    const scene = new THREE.Scene();
    const dim = new ZoneDimmer();
    const b = buildBuilding(scene, dim);
    b.applyTheme(NIGHT);
    settle(b, dim, { x: 6, z: 12 });
    const lounge = pointLights(scene).filter((l) => l.intensity > 0 && l.position.x < 13);
    expect(lounge.length).toBe(5);
    b.applyTheme(DAY);
    settle(b, dim, { x: 6, z: 12 });
    expect(pointLights(scene).filter((l) => l.intensity > 0 && l.position.x < 13)).toHaveLength(0);
  });

  test('corridor sconces: glow + wall fill by day, brighter at night, never a real light', () => {
    const scene = new THREE.Scene();
    const dim = new ZoneDimmer();
    const b = buildBuilding(scene, dim);
    const focus = { x: 14.5, z: 12 }; // standing in the corridor
    const wallFill = () => (scene.getObjectByName('corridor:wall') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>)
      .material.emissive.r;
    b.applyTheme(DAY);
    settle(b, dim, focus);
    const day = colourSum(scene, 'glow:corridor');
    expect(day).toBeGreaterThan(0);
    expect(wallFill()).toBeGreaterThan(0);
    const dayLights = pointLights(scene).filter((l) => l.intensity > 0);
    expect(dayLights.every((l) => l.position.x < 13 || l.position.x > 16)).toBe(true); // pool stays on room lamps
    b.applyTheme(NIGHT);
    settle(b, dim, focus);
    const night = colourSum(scene, 'glow:corridor');
    expect(night).toBeGreaterThan(day);
    expect(pointLights(scene).length).toBeLessThanOrEqual(6);
    expect(pointLights(scene).filter((l) => l.intensity > 0).every((l) => l.position.x < 13 || l.position.x > 16)).toBe(true);
    dim.setZone('lounge'); // the corridor dims with the other zones
    settle(b, dim, focus);
    expect(colourSum(scene, 'glow:corridor')).toBeLessThan(night * OTHER_ZONE_BRIGHTNESS + 1e-6);
  });

  test('glow vertex colours scale with the zone dim factor', () => {
    const scene = new THREE.Scene();
    const dim = new ZoneDimmer();
    const b = buildBuilding(scene, dim);
    b.applyTheme(NIGHT);
    const focus = { x: 6, z: 12 }; // in the lounge: the reading-room desk lamps all draw as glow
    settle(b, dim, focus);
    const full = colourSum(scene, 'glow:reading');
    expect(full).toBeGreaterThan(0);
    dim.setZone('lounge'); // the reading room fades to OTHER_ZONE_BRIGHTNESS
    settle(b, dim, focus);
    const dimmed = colourSum(scene, 'glow:reading');
    const f = OTHER_ZONE_BRIGHTNESS;
    // diffuse part ∝ f² (lamp level × dimmed surface), sheen part ∝ f
    expect(dimmed).toBeGreaterThanOrEqual(full * f * f - 1e-6);
    expect(dimmed).toBeLessThanOrEqual(full * f + 1e-6);
    dim.setZone(null);
    settle(b, dim, focus);
    expect(colourSum(scene, 'glow:reading')).toBeCloseTo(full, 5);
  });
});

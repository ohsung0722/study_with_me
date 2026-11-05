// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { MAP, OTHER_ZONE_BRIGHTNESS, type ZoneId } from '@studyverse/shared';
import { buildBuilding, type Building, type RoomLevels } from '../src/three/building';
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
function settle(b: Building, dim: ZoneDimmer, focus: { x: number; z: number }, ms = 2000, rooms?: RoomLevels) {
  for (let t = 0; t < ms; t += 16) { dim.update(16); b.update(16, focus, rooms); }
}
/** Study-room light levels: the listed rooms fully on, the rest off. */
const lit = (...on: ZoneId[]): RoomLevels => ({ level: (z) => (on.includes(z) ? 1 : 0) });
const inRect = (l: THREE.PointLight, r: { x1: number; z1: number; x2: number; z2: number }) =>
  l.position.x > r.x1 && l.position.x < r.x2 && l.position.z > r.z1 && l.position.z < r.z2;
/** Emitted red (shades scale emissiveIntensity, the lamp fill writes the emissive colour). */
const emissive = (scene: THREE.Scene, name: string) => {
  const m = (scene.getObjectByName(name) as THREE.Mesh).material as THREE.MeshLambertMaterial;
  return m.emissive.r * m.emissiveIntensity;
};

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

  test('study rooms: lights follow occupancy (not the theme), day and night; real lights stay ≤ 6', () => {
    const scene = new THREE.Scene();
    const dim = new ZoneDimmer();
    const b = buildBuilding(scene, dim);
    const A = MAP.zones.studyA, B = MAP.zones.studyB;
    const inA = { x: 21, z: 16.5 };
    for (const theme of [NIGHT, DAY]) {
      b.applyTheme(theme);
      // nobody in either room: dark, even at night (no pool light, no glow, shades off)
      settle(b, dim, inA, 2000, lit());
      expect(pointLights(scene).filter((l) => l.intensity > 0 && (inRect(l, A) || inRect(l, B)))).toHaveLength(0);
      expect(colourSum(scene, 'glow:studyA')).toBe(0);
      expect(emissive(scene, 'pendant:studyA')).toBe(0);
      // someone in A: A's lamps take pool lights near me and glow; B stays dark
      settle(b, dim, inA, 2000, lit('studyA'));
      const ls = pointLights(scene);
      expect(ls.length).toBeLessThanOrEqual(6);
      expect(ls.every((l) => l.visible)).toBe(true);
      expect(ls.filter((l) => l.intensity > 0 && inRect(l, A)).length).toBeGreaterThanOrEqual(2);
      expect(ls.filter((l) => l.intensity > 0 && inRect(l, B))).toHaveLength(0);
      expect(emissive(scene, 'pendant:studyA')).toBeGreaterThan(0);
      expect(emissive(scene, 'pendant:studyB')).toBe(0);
      expect(colourSum(scene, 'glow:studyB')).toBe(0);
    }
    // seen from afar (lamps not pooled), a lit room shows as glow + a warm fill on its walls
    b.applyTheme(NIGHT);
    settle(b, dim, { x: 6, z: 12 }, 2000, lit('studyB'));
    expect(colourSum(scene, 'glow:studyB')).toBeGreaterThan(0);
    expect(emissive(scene, 'studyB:wall')).toBeGreaterThan(0);
    expect(emissive(scene, 'studyA:wall')).toBe(0);
    // no levels given (e.g. older callers): rooms stay dark
    settle(b, dim, { x: 6, z: 12 });
    expect(colourSum(scene, 'glow:studyB')).toBe(0);
  });

  test('study rooms at night: a lit room shows part of its daytime colours, an unlit one stays lofi-dark', () => {
    const scene = new THREE.Scene();
    const dim = new ZoneDimmer();
    const b = buildBuilding(scene, dim);
    const wall = (z: string) => ((scene.getObjectByName(`${z}:wall`) as THREE.Mesh).material as THREE.MeshLambertMaterial).color.r;
    b.applyTheme(NIGHT);
    settle(b, dim, { x: 6, z: 12 }, 1000, lit());
    const dark = wall('studyA');
    expect(wall('studyB')).toBeCloseTo(dark, 6);
    settle(b, dim, { x: 6, z: 12 }, 1000, lit('studyA'));
    expect(wall('studyA')).toBeGreaterThan(dark * 1.5);
    expect(wall('studyB')).toBeCloseTo(dark, 6);
    b.applyTheme(DAY); // by day the colours don't depend on the lights
    const day = wall('studyB');
    expect(wall('studyA')).toBeCloseTo(day, 6);
    b.applyTheme(NIGHT);
    settle(b, dim, { x: 6, z: 12 }, 5000, lit()); // empties: back to dark after the fade
    expect(wall('studyA')).toBeCloseTo(dark, 6);
  });

  test('study rooms: windows (sky + night rain), whiteboard and monitor exist; the screen wakes with the room', () => {
    const scene = new THREE.Scene();
    const dim = new ZoneDimmer();
    const b = buildBuilding(scene, dim);
    for (const z of ['lounge', 'studyA', 'studyB']) {
      expect(scene.getObjectByName(`window:${z}`), z).toBeDefined();
      expect(scene.getObjectByName(`rain:${z}`), z).toBeDefined();
    }
    for (const z of ['studyA', 'studyB']) {
      expect(scene.getObjectByName(`monitor:${z}`), z).toBeDefined();
      expect(scene.getObjectByName(`${z}:decor`), z).toBeDefined(); // whiteboard, sticky notes, clock, rug…
    }
    const screen = (z: string) => ((scene.getObjectByName(`monitor:${z}`) as THREE.Mesh).material as THREE.MeshBasicMaterial).color.r;
    b.applyTheme(DAY);
    settle(b, dim, { x: 21, z: 16.5 }, 1000, lit('studyA'));
    expect(screen('studyA')).toBeGreaterThan(0.8);
    expect(screen('studyB')).toBeLessThan(0.2);
    b.applyTheme(NIGHT);
    expect((scene.getObjectByName('rain:studyB') as THREE.Mesh).visible).toBe(true);
    b.applyTheme(DAY);
    expect((scene.getObjectByName('rain:studyB') as THREE.Mesh).visible).toBe(false);
    // windows dim with their room
    const sky = (z: string) => ((scene.getObjectByName(`window:${z}`) as THREE.Mesh).material as THREE.MeshBasicMaterial).color.r;
    const full = sky('studyB');
    dim.setZone('studyA');
    settle(b, dim, { x: 21, z: 16.5 }, 1000, lit('studyA'));
    expect(sky('studyB')).toBeCloseTo(full * OTHER_ZONE_BRIGHTNESS, 5);
  });
});

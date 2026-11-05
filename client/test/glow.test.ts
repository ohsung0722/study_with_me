import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { GlowLayer, glowFalloff, glowQuad } from '../src/three/glow';

describe('glowQuad', () => {
  test('unclipped: a 2r square with UVs 0..1 centred on the lamp', () => {
    expect(glowQuad(5, 3, 1, { x1: -100, z1: -100, x2: 100, z2: 100 })).toEqual({
      x1: 4, z1: 2, x2: 6, z2: 4, u1: 0, v1: 0, u2: 1, v2: 1,
    });
  });

  test('clipped to a desk top: the quad stops at the edges, UVs keep the gradient centred on the lamp', () => {
    const q = glowQuad(0, 0, 1, { x1: -0.5, z1: -2, x2: 2, z2: 0.25 })!;
    expect(q).toMatchObject({ x1: -0.5, z1: -1, x2: 1, z2: 0.25 });
    expect(q.u1).toBeCloseTo(0.25);
    expect(q.u2).toBeCloseTo(1);
    expect(q.v1).toBeCloseTo(0);
    expect(q.v2).toBeCloseTo(0.625);
  });

  test('null when the circle misses the surface', () => {
    expect(glowQuad(0, 0, 1, { x1: 2, z1: 2, x2: 3, z2: 3 })).toBeNull();
  });
});

describe('glowFalloff', () => {
  test('1 at the centre, smoothly to 0 at the rim and beyond', () => {
    expect(glowFalloff(0)).toBe(1);
    expect(glowFalloff(0.5)).toBeGreaterThan(glowFalloff(0.7));
    expect(glowFalloff(1)).toBe(0);
    expect(glowFalloff(1.4)).toBe(0);
  });
});

describe('GlowLayer', () => {
  test('one additive, depth-write-off mesh per zone; lamp × surface × level goes into vertex colours', () => {
    const parent = new THREE.Group();
    const layer = new GlowLayer(parent, new THREE.Texture());
    const a = layer.add('reading', glowQuad(0, 0, 1, { x1: -9, z1: -9, x2: 9, z2: 9 })!, 0.8, 'desk');
    const b = layer.add('reading', glowQuad(3, 0, 1, { x1: -9, z1: -9, x2: 9, z2: 9 })!, 0.8, 'desk');
    const c = layer.add('lounge', glowQuad(0, 5, 2, { x1: -9, z1: -9, x2: 9, z2: 9 })!, 0.02);
    layer.build();
    const meshes = parent.children as THREE.Mesh[];
    expect(meshes).toHaveLength(2);
    for (const m of meshes) {
      const mat = m.material as THREE.MeshBasicMaterial;
      expect(mat.blending).toBe(THREE.AdditiveBlending);
      expect(mat.depthWrite).toBe(false);
      expect(mat.vertexColors).toBe(true);
    }
    layer.setColor(0xffffff);
    layer.setSurface('desk', 0xffffff, 0.5);
    layer.set(a, 0.5);
    layer.set(b, 0, 0.1);
    layer.set(c, 1);
    layer.flush();
    const reading = meshes.find((m) => m.name === 'glow:reading')!;
    const col = reading.geometry.getAttribute('color');
    expect(col.getX(0)).toBeCloseTo(0.25); // quad a: white lamp × 0.5 surface × 0.5
    expect(col.getX(4)).toBeCloseTo(0.1);  // quad b: sheen only (not tinted by the surface)
    const lounge = meshes.find((m) => m.name === 'glow:lounge')!;
    expect(lounge.geometry.getAttribute('color').getX(0)).toBeCloseTo(1); // no surface: untinted
    const pos = reading.geometry.getAttribute('position');
    expect(pos.getY(0)).toBeCloseTo(0.8);
  });

  test('wall pools: an upright quad on the plane x = wallX (quad x → world z, quad z → height), same zone mesh', () => {
    const parent = new THREE.Group();
    const layer = new GlowLayer(parent, new THREE.Texture());
    const floor = layer.add('corridor', glowQuad(14.5, 5, 2, { x1: 13, z1: 0, x2: 16, z2: 24 })!, 0.025);
    // a sconce at z=5, y=2 on the x=13.1 wall face, clipped to the wall segment z0–10 and the wall height 0–3
    const q = glowQuad(5, 2, 1.5, { x1: 0, z1: 0, x2: 10, z2: 3 })!;
    const wall = layer.addWall('corridor', 13.1, q, 'wall');
    layer.build();
    expect(parent.children).toHaveLength(1); // floor and wall pools share the zone's one mesh
    const mesh = parent.children[0] as THREE.Mesh;
    expect((mesh.material as THREE.MeshBasicMaterial).side).toBe(THREE.DoubleSide);
    const pos = mesh.geometry.getAttribute('position');
    const xs = [4, 5, 6, 7].map(i => pos.getX(i)), ys = [4, 5, 6, 7].map(i => pos.getY(i)), zs = [4, 5, 6, 7].map(i => pos.getZ(i));
    expect(xs.every(x => Math.abs(x - 13.1) < 1e-6)).toBe(true);
    expect(Math.min(...zs)).toBeCloseTo(3.5); expect(Math.max(...zs)).toBeCloseTo(6.5);
    expect(Math.min(...ys)).toBeCloseTo(0.5); expect(Math.max(...ys)).toBeCloseTo(3);
    layer.setColor(0xffffff);
    layer.setSurface('wall', 0xffffff, 0.5);
    layer.set(floor, 1);
    layer.set(wall, 1, 0.2);
    layer.flush();
    const col = mesh.geometry.getAttribute('color');
    expect(col.getX(0)).toBeCloseTo(1);
    expect(col.getX(4)).toBeCloseTo(0.7); // 0.5 surface × 1 + 0.2 sheen
  });
});

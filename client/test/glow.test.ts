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
});

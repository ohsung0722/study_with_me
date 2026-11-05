import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { dropShadows } from '../src/three/scene';

describe('dropShadows (the low quality tier)', () => {
  test('turns shadows off, frees the shadow map and flags materials for recompile', () => {
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight();
    key.castShadow = true;
    const map = new THREE.WebGLRenderTarget(1024, 1024);
    const dispose = vi.spyOn(map, 'dispose');
    key.shadow.map = map;
    const mat = new THREE.MeshLambertMaterial();
    scene.add(key, new THREE.Mesh(new THREE.BoxGeometry(), mat));
    const version = mat.version;
    const shadowMap = { enabled: true };
    dropShadows(shadowMap, key, scene);
    expect(shadowMap.enabled).toBe(false);
    expect(key.castShadow).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(key.shadow.map).toBeNull();
    expect(mat.version).toBeGreaterThan(version);
  });
});

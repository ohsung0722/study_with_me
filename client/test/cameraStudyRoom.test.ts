// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { MAP } from '@studyverse/shared';
import { CameraRig } from '../src/game/camera';
import { buildBuilding } from '../src/three/building';
import { ZoneDimmer } from '../src/three/zoneDim';

beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterAll(() => { vi.restoreAllMocks(); });

describe('follow camera in the study rooms (same pitch as everywhere else)', () => {
  test('looking along the room at the default pitch, the walls barely pull the camera in', () => {
    const scene = new THREE.Scene();
    buildBuilding(scene, new ZoneDimmer());
    const occluders: THREE.Object3D[] = []; // as in Game: the building's wall and machine meshes
    scene.getObjectByName('building')!.children.forEach((o) => {
      if ((o as THREE.Mesh).isMesh && ['wall', 'machine'].includes(o.name.split(':')[1])) occluders.push(o);
    });
    const cam = new THREE.PerspectiveCamera();
    const head = new THREE.Vector3();
    for (const room of ['studyA', 'studyB', 'studyC', 'studyD'] as const) {
      const r = MAP.zones[room], zm = (r.z1 + r.z2) / 2;
      for (const x of [r.x1 + 1.5, r.x2 - 1.5]) { // either end of the table, on the room's middle line
        for (const yaw of [0, Math.PI]) {  // camera toward the entrance-side wall, then the back wall
          const rig = new CameraRig(cam, document.createElement('div'));
          rig.yaw = yaw;
          for (let i = 0; i < 100; i++) rig.follow(new THREE.Vector3(x, 0, zm), 16, occluders);
          head.set(x, 1.4, zm);
          expect(cam.position.distanceTo(head), `${room} x=${x} yaw=${yaw}`).toBeGreaterThan(rig.dist * 0.9);
          rig.dispose();
        }
      }
    }
  });
});

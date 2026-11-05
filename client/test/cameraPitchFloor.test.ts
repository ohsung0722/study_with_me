// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import {
  CameraRig, PITCH_FLOOR_TAU_MS, STUDY_PITCH_FLOOR, approachPitchFloor, pitchFloorFor,
} from '../src/game/camera';

describe('pitchFloorFor (steeper follow camera in the 5 m-deep study rooms)', () => {
  test('study rooms get the floor, every other zone (and outside) none', () => {
    expect(STUDY_PITCH_FLOOR).toBeGreaterThan(0.8);
    expect(STUDY_PITCH_FLOOR).toBeLessThan(0.9);
    expect(pitchFloorFor('studyA')).toBe(STUDY_PITCH_FLOOR);
    expect(pitchFloorFor('studyB')).toBe(STUDY_PITCH_FLOOR);
    for (const z of ['lounge', 'corridor', 'reading', null] as const) expect(pitchFloorFor(z)).toBe(0);
  });
});

describe('approachPitchFloor (eases toward the zone floor)', () => {
  test('~63 % of the gap after one time constant, both ways', () => {
    expect(PITCH_FLOOR_TAU_MS).toBeGreaterThanOrEqual(250);
    expect(PITCH_FLOOR_TAU_MS).toBeLessThanOrEqual(350);
    expect(approachPitchFloor(0, 0.85, PITCH_FLOOR_TAU_MS)).toBeCloseTo(0.85 * (1 - Math.exp(-1)), 9);
    expect(approachPitchFloor(0.85, 0, PITCH_FLOOR_TAU_MS)).toBeCloseTo(0.85 * Math.exp(-1), 9);
  });
  test('frame-rate independent, settles, and dt ≤ 0 changes nothing', () => {
    let a = 0, b = 0;
    for (let i = 0; i < 60; i++) a = approachPitchFloor(a, 0.85, 16);
    for (let i = 0; i < 30; i++) b = approachPitchFloor(b, 0.85, 32);
    expect(a).toBeCloseTo(b, 9);
    let c = 0;
    for (let i = 0; i < 300; i++) c = approachPitchFloor(c, 0.85, 16);
    expect(c).toBeCloseTo(0.85, 6);
    expect(approachPitchFloor(0.4, 0.85, 0)).toBe(0.4);
    expect(approachPitchFloor(0.4, 0.85, -5)).toBe(0.4);
  });
});

describe('CameraRig.pitchFloor', () => {
  const rig = () => {
    const cam = new THREE.PerspectiveCamera();
    const r = new CameraRig(cam, document.createElement('div'));
    return { cam, r };
  };
  const target = new THREE.Vector3(26, 0, 17);
  const elevation = (cam: THREE.Camera) => {
    const head = new THREE.Vector3(target.x, 1.4, target.z);
    const d = cam.position.clone().sub(head);
    return Math.atan2(d.y, Math.hypot(d.x, d.z));
  };

  test('the camera looks down at max(pitch, pitchFloor); the player pitch itself is untouched', () => {
    const { cam, r } = rig();
    r.pitch = 0.5;
    r.follow(target, 16, []);
    expect(elevation(cam)).toBeCloseTo(0.5, 6);
    r.pitchFloor = 0.85;
    r.follow(target, 10_000, []); // let the smoothing settle
    expect(elevation(cam)).toBeCloseTo(0.85, 6);
    expect(r.pitch).toBe(0.5);
    r.pitch = 1.1; // a steeper hand-picked pitch wins over the floor
    r.follow(target, 10_000, []);
    expect(elevation(cam)).toBeCloseTo(1.1, 6);
    r.dispose();
  });

  test('updatePitchFloor eases toward the floor of the zone I am in', () => {
    const { r } = rig();
    expect(r.pitchFloor).toBe(0);
    r.updatePitchFloor('studyA', PITCH_FLOOR_TAU_MS);
    expect(r.pitchFloor).toBeCloseTo(STUDY_PITCH_FLOOR * (1 - Math.exp(-1)), 9);
    for (let i = 0; i < 200; i++) r.updatePitchFloor('studyB', 16);
    expect(r.pitchFloor).toBeCloseTo(STUDY_PITCH_FLOOR, 4);
    for (let i = 0; i < 200; i++) r.updatePitchFloor('corridor', 16);
    expect(r.pitchFloor).toBeCloseTo(0, 4);
    r.dispose();
  });
});

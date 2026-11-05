// Rounded 2-head-tall ("동글동글") chibi avatar from the approved avatar-rounded.html mockup.
// Each rigid part is one merged, vertex-coloured mesh sharing a single per-avatar material, so an avatar costs
// ~6 draw calls and setDim() only has to scale one material colour.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Appearance, DrinkId } from '@studyverse/shared';
import { newSipState, stepSip } from './sip';
import { deskCupSpot } from './cupSpot';

export type Pose = 'stand' | 'walk' | 'sit';

export interface AvatarRig {
  root: THREE.Group;
  /** 'sit': a held drink goes onto the desk/table in front (from the map, using root position/rotation); sofas keep it in hand. */
  setPose(p: Pose): void;
  wave(durationMs?: number): void;
  setDrink(d: DrinkId | null): void;
  setDim(f: number): void;
  update(dtMs: number): void;
  dispose(): void;
}

const SKIN = 0xffe0c2;
const PANTS = 0x4a5a7a;
const SHOE = 0x4a3a30;
const EYE = 0x2a2a2a;
const MOUTH = 0x8a4b3c;
const BLUSH = 0xffafac; // mockup's 0xff9aa2 @ 70% over skin, baked opaque
const LEG_LEN = 0.28, ARM_LEN = 0.26;
const HIP_STAND = 0.32, HIP_SIT = 0.5;
const WAVE_MS = 2200;
const CUP_ARM_Z = -0.25;           // cup arm's resting outward tilt
const SIP_ARM_X = -1.9, SIP_ARM_Z = 0.35; // cup just under the chin, hand pulled toward the face
const CUP_IN_HAND: [number, number, number] = [0, -ARM_LEN - 0.02, 0.07];
const CUP_ON_DESK_Y = 0.78 + 0.06; // desk top + half the cup

const tmpColor = new THREE.Color();

/** Bake a solid vertex colour into a geometry (after transforming it). */
function part(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation,
  pos: [number, number, number] = [0, 0, 0], opts: { scale?: [number, number, number]; rotX?: number; rotZ?: number } = {}): THREE.BufferGeometry {
  if (opts.scale) geo.scale(...opts.scale);
  if (opts.rotX) geo.rotateX(opts.rotX);
  if (opts.rotZ) geo.rotateZ(opts.rotZ);
  geo.translate(...pos);
  tmpColor.set(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  return g;
}

/** Capsule limb hanging from the group origin with a ball (hand/foot) at the end. */
function limbGeo(len: number, r: number, color: THREE.ColorRepresentation, endColor: number, endR: number, endZ: number) {
  return merged([
    part(new THREE.CapsuleGeometry(r, len - 2 * r, 8, 16), color, [0, -len / 2, 0]),
    part(new THREE.SphereGeometry(endR, 16, 12), endColor, [0, -len, endZ]),
  ]);
}

// Shared across all avatars (no per-avatar colour).
let legGeo: THREE.BufferGeometry | null = null;
const cupGeos = new Map<DrinkId, THREE.BufferGeometry>();
const DRINK_LOOK: Record<DrinkId, { body: number; top: number; can?: boolean }> = {
  americano: { body: 0xf5f0e6, top: 0x3b2416 },
  latte: { body: 0xf5f0e6, top: 0xd9b48f },
  greenTea: { body: 0x8fd18f, top: 0xf2f2f2, can: true },
  ionDrink: { body: 0x5aaee8, top: 0xf2f2f2, can: true },
};
function cupGeo(d: DrinkId): THREE.BufferGeometry {
  let g = cupGeos.get(d);
  if (!g) {
    const look = DRINK_LOOK[d];
    g = look.can
      ? merged([
        part(new THREE.CylinderGeometry(0.04, 0.04, 0.13, 14), look.body, [0, 0, 0]),
        part(new THREE.CylinderGeometry(0.03, 0.04, 0.03, 14), look.top, [0, 0.08, 0]),
      ])
      : merged([
        part(new THREE.CylinderGeometry(0.052, 0.04, 0.12, 14), look.body, [0, 0, 0]),
        part(new THREE.CylinderGeometry(0.056, 0.054, 0.025, 14), look.top, [0, 0.072, 0]),
      ]);
    cupGeos.set(d, g);
  }
  return g;
}

let waveMat: THREE.SpriteMaterial | null = null;
function waveMaterial(): THREE.SpriteMaterial {
  if (!waveMat) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      g.font = '48px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('👋', 32, 36);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    waveMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  }
  return waveMat;
}

export function createAvatar(a: Appearance): AvatarRig {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 });
  const own: THREE.BufferGeometry[] = []; // per-avatar geometries to dispose
  const mesh = (geo: THREE.BufferGeometry, parent: THREE.Object3D, shared = false) => {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    parent.add(m);
    if (!shared) own.push(geo);
    return m;
  };

  const root = new THREE.Group();
  root.name = 'avatar';
  const hip = new THREE.Group();
  hip.position.y = HIP_STAND;
  root.add(hip);

  // round body
  const body = mesh(part(new THREE.SphereGeometry(0.27, 32, 24), a.shirtColor, [0, 0, 0], { scale: [1, 1.05, 0.85] }), hip);
  body.position.y = 0.24;

  // big round head (+ hair, face) as one mesh
  const head = new THREE.Group();
  head.position.y = 0.78;
  hip.add(head);
  const headParts = [
    part(new THREE.SphereGeometry(0.38, 32, 24), SKIN),
    part(new THREE.SphereGeometry(0.405, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), a.hairColor, [0, 0.03, -0.02], { rotX: -0.25 }),
    part(new THREE.TorusGeometry(0.04, 0.012, 8, 16, Math.PI), MOUTH, [0, -0.1, 0.37], { rotZ: Math.PI }),
  ];
  if (a.hair === 'bun') headParts.push(part(new THREE.SphereGeometry(0.14, 20, 16), a.hairColor, [0, 0.38, -0.14]));
  if (a.hair === 'long') headParts.push(part(new THREE.SphereGeometry(0.36, 24, 18), a.hairColor, [0, -0.12, -0.12], { scale: [1.05, 1.1, 0.8] }));
  for (const s of [-1, 1]) {
    headParts.push(part(new THREE.SphereGeometry(0.045, 12, 12), EYE, [s * 0.13, -0.02, 0.35]));
    headParts.push(part(new THREE.SphereGeometry(0.05, 12, 12), BLUSH, [s * 0.22, -0.1, 0.31], { scale: [1.3, 0.7, 0.4] }));
  }
  mesh(merged(headParts), head);

  // round limbs with ball hands/feet
  legGeo ??= limbGeo(LEG_LEN, 0.08, PANTS, SHOE, 0.1, 0.04);
  const legs = [-1, 1].map(s => {
    const g = new THREE.Group();
    g.position.set(s * 0.11, 0.05, 0);
    mesh(legGeo!, g, true);
    hip.add(g);
    return g;
  });
  const armGeo = limbGeo(ARM_LEN, 0.065, a.shirtColor, SKIN, 0.075, 0);
  own.push(armGeo);
  const arms = [-1, 1].map(s => {
    const g = new THREE.Group();
    g.position.set(s * 0.3, 0.36, 0);
    g.rotation.z = s * 0.25;
    mesh(armGeo, g, true);
    hip.add(g);
    return g;
  });
  // arms[1] (+x) waves as in the mockup; the drink goes in the other hand, arms[0] (the avatar's anatomical right).
  const waveArm = arms[1], cupArm = arms[0];

  const waveSprite = new THREE.Sprite(waveMaterial());
  waveSprite.scale.set(0.32, 0.32, 1);
  waveSprite.position.set(0, 2.4, 0);
  waveSprite.visible = false;
  root.add(waveSprite);

  let pose: Pose = 'stand';
  let t = Math.random() * 10; // desync idle animations between avatars
  let waveLeft = 0;
  let drink: DrinkId | null = null;
  let cup: THREE.Mesh | null = null;
  const sip = newSipState();
  let cupKey = '';

  /** Cup in the hand, or on the desk/table in front while seated at one. Recomputed when pose/place changes. */
  const placeCup = () => {
    if (!cup) return;
    const key = pose === 'sit' ? `${root.position.x},${root.position.z},${root.rotation.y}` : 'hand';
    if (key === cupKey && cup.parent) return;
    cupKey = key;
    const spot = pose === 'sit' ? deskCupSpot(root.position.x, root.position.z, root.rotation.y) : null;
    const parent = spot ? root : cupArm;
    if (cup.parent !== parent) parent.add(cup);
    if (spot) cup.position.set(spot.x, CUP_ON_DESK_Y, spot.z);
    else cup.position.set(...CUP_IN_HAND);
  };

  const approach = (cur: number, target: number, k: number) => cur + (target - cur) * k;

  return {
    root,
    setPose(p) {
      pose = p;
      placeCup();
    },
    wave(durationMs = WAVE_MS) {
      waveLeft = Math.max(waveLeft, durationMs);
    },
    setDrink(d) {
      if (d === drink) return;
      drink = d;
      if (cup) {
        cup.removeFromParent();
        cup = null;
      }
      if (d) {
        cup = new THREE.Mesh(cupGeo(d), material);
        cup.castShadow = true;
        cupKey = '';
        placeCup();
      }
    },
    setDim(f) {
      material.color.setScalar(f);
    },
    update(dtMs) {
      const dt = dtMs / 1000;
      t += dt;
      const k = Math.min(1, dt * 14); // limb smoothing between poses
      let legX = 0, armX = 0, hipY = HIP_STAND, headX = Math.sin(t * 0.8) * 0.03, headZ = 0, swing = 0;
      if (pose === 'sit') {
        legX = -Math.PI / 2;
        armX = -1.2;
        hipY = HIP_SIT;
        headX = 0.3 + Math.sin(t * 0.9) * 0.05;
      } else if (pose === 'walk') {
        swing = Math.sin(t * 10) * 0.55;
        hipY = HIP_STAND + Math.abs(Math.cos(t * 10)) * 0.05;
        headZ = Math.sin(t * 10) * 0.04;
        headX = 0;
      }
      legs[0].rotation.x = approach(legs[0].rotation.x, legX + swing, k);
      legs[1].rotation.x = approach(legs[1].rotation.x, legX - swing, k);
      placeCup(); // the caller may move the root after setPose('sit')
      // occasional sip while holding a drink (not seated, not waving)
      const lift = stepSip(sip, dtMs, cup !== null && cup.parent === cupArm && pose !== 'sit' && waveLeft === 0);
      const cupArmX = armX - swing * (1 - lift);
      cupArm.rotation.x = approach(cupArm.rotation.x, cupArmX + (SIP_ARM_X - cupArmX) * lift, k);
      cupArm.rotation.z = approach(cupArm.rotation.z, CUP_ARM_Z + (SIP_ARM_Z - CUP_ARM_Z) * lift, k);
      hip.position.y = pose === 'walk' ? hipY : approach(hip.position.y, hipY, k);
      head.rotation.x = approach(head.rotation.x, headX, k);
      head.rotation.z = headZ;
      body.scale.y = pose === 'walk' ? 1 : 1 + Math.sin(t * 2) * 0.012; // idle breathing

      if (waveLeft > 0) {
        waveLeft = Math.max(0, waveLeft - dtMs);
        waveArm.rotation.z = 2.6 + Math.sin(t * 12) * 0.35;
        waveArm.rotation.x = approach(waveArm.rotation.x, 0, k);
      } else {
        waveArm.rotation.z = approach(waveArm.rotation.z, 0.25, k);
        waveArm.rotation.x = approach(waveArm.rotation.x, armX + swing + (pose === 'sit' ? Math.sin(t * 2) * 0.06 : 0), k);
      }
      waveSprite.visible = waveLeft > 0;
    },
    dispose() {
      root.removeFromParent();
      own.forEach(g => g.dispose());
      material.dispose();
    },
  };
}

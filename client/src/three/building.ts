// The building, built from the shared MAP. Static geometry is merged per (zone, role) so each zone/role pair is one
// draw call with its own material — that keeps draw calls low and lets ZoneDimmer dim each zone separately.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP, zoneAt, type Prop, type Wall, type ZoneId } from '@studyverse/shared';
import type { Theme } from './theme';
import type { ZoneDimmer } from './zoneDim';

type ThemedRole = 'floor' | 'wall' | 'desk' | 'part';
const FIXED = {
  book: 0xf2efe6, metal: 0x333333, sofa: 0xc96b4b, cushion: 0xd9806a, beanbag: 0x7c5cff,
  machine: 0x333a44, screen: 0x7fd0ff, coffee: 0x222222, counterTop: 0xe9e2d4, pot: 0x8a5a3a, leaf: 0x5aa060,
  studyChair: 0x5f7f99, radio: 0x9b6b4a, rug: 0xb5835a, mat: 0x5a4636,
} as const;
type FixedRole = keyof typeof FIXED;
type Role = ThemedRole | FixedRole | 'glass';
const THEMED: readonly ThemedRole[] = ['floor', 'wall', 'desk', 'part'];

/** Slight per-zone floor variation so rooms read as distinct spaces. */
const FLOOR_TINT: Record<ZoneId, number> = { lounge: 1.1, corridor: 0.88, reading: 1, studyA: 1.05, studyB: 1.05 };

const MAX_LAMP_LIGHTS = 24;
// Warm lounge lamps that switch on at night. Placed inside existing collider rects (sofa shelves, counter,
// board cabinet) or against a wall so players don't walk through them.
const LOUNGE_LAMPS: { x: number; z: number; baseY: number; kind: 'floor' | 'table' }[] = [
  { x: 4.2, z: 9.3, baseY: 0.6, kind: 'table' },    // on sofa 1's back shelf
  { x: 6.8, z: 14.7, baseY: 0.6, kind: 'table' },   // on sofa 2's back shelf
  { x: 0.4, z: 2.3, baseY: 1.0, kind: 'table' },    // coffee counter (lights the coffee/vending corner)
  { x: 7.15, z: 0.32, baseY: 0.7, kind: 'table' },  // board cabinet (lights the record board)
  { x: 7.3, z: 23.6, baseY: 0, kind: 'floor' },     // by the radio, against the entrance-side wall
];
const LOUNGE_LIGHT_I = 10;    // full-night intensity (× night × lounge dim factor)
const LOUNGE_LIGHT_DIST = 8;
const LOUNGE_LIGHT_DECAY = 1.1;
const LOUNGE_SHADE = 0xf3e3c3;
const WALL_H = MAP.wallHeight;
const DESK_H = 0.75;
const RAIN_DROPS = 160;

export interface Building {
  applyTheme(t: Theme): void;
  seatMarkers: Map<string, THREE.Object3D>;
  /** Animates the rain and keeps lamp glow / light intensities in step with zone dimming. Call every frame. */
  update(dtMs: number): void;
}

/** Zone for a point, clamped into the building (outer-wall corners fall outside every zone). */
function zoneOf(x: number, z: number): ZoneId {
  const cx = Math.min(MAP.width - 0.001, Math.max(0.001, x));
  const cz = Math.min(MAP.depth - 0.001, Math.max(0.001, z));
  return zoneAt(cx, cz) ?? 'corridor';
}
const inside = (x: number, z: number) => zoneAt(x, z) !== null;

export function buildBuilding(scene: THREE.Scene, dim: ZoneDimmer): Building {
  const root = new THREE.Group();
  root.name = 'building';
  scene.add(root);

  // ---------- geometry buckets ----------
  const buckets = new Map<string, { zone: ZoneId; role: Role; geos: THREE.BufferGeometry[] }>();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);

  function put(zone: ZoneId, role: Role, geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0): void {
    q.setFromAxisAngle(Y, ry);
    geo.applyMatrix4(m4.compose(p.set(x, y, z), q, s.set(1, 1, 1)));
    const k = `${zone}:${role}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = { zone, role, geos: [] }));
    b.geos.push(geo);
  }
  const box = (zone: ZoneId, role: Role, sx: number, sy: number, sz: number, x: number, y: number, z: number, ry = 0) =>
    put(zone, role, new THREE.BoxGeometry(sx, sy, sz), x, y, z, ry);
  /** Box given in a seat/prop's local frame (local +z = facing direction). */
  const localBox = (zone: ZoneId, role: Role, o: { x: number; z: number; facing: number },
    sx: number, sy: number, sz: number, lx: number, y: number, lz: number) => {
    const c = Math.cos(o.facing), sn = Math.sin(o.facing);
    box(zone, role, sx, sy, sz, o.x + lx * c + lz * sn, y, o.z - lx * sn + lz * c, o.facing);
  };

  // ---------- floors ----------
  for (const [id, r] of Object.entries(MAP.zones) as [ZoneId, (typeof MAP.zones)[ZoneId]][]) {
    box(id, 'floor', r.x2 - r.x1, 0.1, r.z2 - r.z1, (r.x1 + r.x2) / 2, -0.05, (r.z1 + r.z2) / 2);
  }
  box('lounge', 'rug', 3.4, 0.02, 2.2, 5.5, 0.01, 12);
  box('corridor', 'mat', 2.2, 0.02, 1.0, 14.5, 0.01, 23.3);

  // ---------- walls: split along zone boundaries and into two half-thickness slabs, one per side ----------
  const xCuts = [...new Set(Object.values(MAP.zones).flatMap(r => [r.x1, r.x2]))];
  const zCuts = [...new Set(Object.values(MAP.zones).flatMap(r => [r.z1, r.z2]))];
  const addWall = (w: Wall) => {
    const role: Role = w.glass ? 'glass' : 'wall';
    const alongZ = w.z2 - w.z1 > w.x2 - w.x1;
    const [a0, a1] = alongZ ? [w.z1, w.z2] : [w.x1, w.x2];
    const cuts = [a0, ...(alongZ ? zCuts : xCuts).filter(c => c > a0 && c < a1).sort((m, n) => m - n), a1];
    for (let i = 0; i < cuts.length - 1; i++) {
      const b0 = cuts[i], b1 = cuts[i + 1], mid = (b0 + b1) / 2, len = b1 - b0;
      if (alongZ) {
        const xm = (w.x1 + w.x2) / 2, half = (w.x2 - w.x1) / 2;
        const west = inside(w.x1 - 0.05, mid) ? zoneOf(w.x1 - 0.05, mid) : zoneOf(w.x2 + 0.05, mid);
        const east = inside(w.x2 + 0.05, mid) ? zoneOf(w.x2 + 0.05, mid) : zoneOf(w.x1 - 0.05, mid);
        box(west, role, half, WALL_H, len, xm - half / 2, WALL_H / 2, mid);
        box(east, role, half, WALL_H, len, xm + half / 2, WALL_H / 2, mid);
        if (w.glass) for (const y of [0.04, WALL_H - 0.04]) box(east, 'part', w.x2 - w.x1 + 0.02, 0.08, len, xm, y, mid);
      } else {
        const zm = (w.z1 + w.z2) / 2, half = (w.z2 - w.z1) / 2;
        const north = inside(mid, w.z1 - 0.05) ? zoneOf(mid, w.z1 - 0.05) : zoneOf(mid, w.z2 + 0.05);
        const south = inside(mid, w.z2 + 0.05) ? zoneOf(mid, w.z2 + 0.05) : zoneOf(mid, w.z1 - 0.05);
        box(north, role, len, WALL_H, half, mid, WALL_H / 2, zm - half / 2);
        box(south, role, len, WALL_H, half, mid, WALL_H / 2, zm + half / 2);
      }
    }
  };
  MAP.walls.forEach(addWall);

  // ---------- seats (chairs + markers) ----------
  const seatMarkers = new Map<string, THREE.Object3D>();
  const seatGroup = new THREE.Group();
  seatGroup.name = 'seats';
  root.add(seatGroup);
  for (const seat of MAP.seats) {
    const mk = new THREE.Object3D();
    mk.name = `seat:${seat.id}`;
    mk.position.set(seat.x, 0, seat.z);
    mk.rotation.y = seat.facing;
    mk.userData = { seatId: seat.id, kind: seat.kind };
    seatGroup.add(mk);
    seatMarkers.set(seat.id, mk);
    if (seat.kind === 'sofa') continue;
    const role: Role = seat.kind === 'desk' ? 'part' : 'studyChair';
    localBox(seat.zone, role, seat, 0.46, 0.06, 0.46, 0, 0.45, 0);
    localBox(seat.zone, role, seat, 0.46, 0.5, 0.06, 0, 0.72, -0.24);
    localBox(seat.zone, 'metal', seat, 0.06, 0.42, 0.06, 0, 0.21, 0);
  }

  // ---------- props ----------
  const shadeGeos: THREE.BufferGeometry[] = [];
  const lampSpots: THREE.Vector3[] = [];
  const seatsNear = (pr: Prop) => MAP.seats
    .filter(st => st.kind === 'sofa')
    .map(st => ({ st, d: Math.hypot(st.x - (pr.x1 + pr.x2) / 2, st.z - (pr.z1 + pr.z2) / 2) }))
    .sort((a, b) => a.d - b.d);

  for (const pr of MAP.props) {
    const cx = (pr.x1 + pr.x2) / 2, cz = (pr.z1 + pr.z2) / 2, w = pr.x2 - pr.x1, d = pr.z2 - pr.z1;
    const zone = zoneOf(cx, cz);
    switch (pr.kind) {
      case 'desk': {
        box(zone, 'desk', w, 0.06, d, cx, DESK_H, cz);
        for (const sx of [-1, 1]) box(zone, 'desk', 0.06, DESK_H - 0.03, d - 0.1, cx + sx * (w / 2 - 0.05), (DESK_H - 0.03) / 2, cz);
        box(zone, 'part', w, 0.55, 0.05, cx, DESK_H + 0.3, cz - d / 2 + 0.025);   // front partition (chair is at +z)
        box(zone, 'part', 0.05, 0.55, d, cx - w / 2 + 0.025, DESK_H + 0.3, cz);    // side partition
        box(zone, 'book', 0.36, 0.04, 0.26, cx + 0.3, DESK_H + 0.05, cz + 0.05, 0.12);
        // desk lamp: base + pole (metal), shade (emissive), light
        box(zone, 'metal', 0.14, 0.03, 0.14, cx - 0.6, DESK_H + 0.045, cz - 0.25);
        box(zone, 'metal', 0.035, 0.42, 0.035, cx - 0.6, DESK_H + 0.24, cz - 0.25);
        const shade = new THREE.ConeGeometry(0.14, 0.16, 16, 1, true);
        shade.translate(cx - 0.56, DESK_H + 0.47, cz - 0.22);
        shadeGeos.push(shade);
        lampSpots.push(new THREE.Vector3(cx - 0.55, DESK_H + 0.35, cz - 0.15));
        break;
      }
      case 'table': {
        box(zone, 'desk', w, 0.06, d, cx, DESK_H, cz);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          box(zone, 'desk', 0.08, DESK_H - 0.03, 0.08, cx + sx * (w / 2 - 0.1), (DESK_H - 0.03) / 2, cz + sz * (d / 2 - 0.1));
        }
        box(zone, 'book', 0.34, 0.04, 0.24, cx - 0.7, DESK_H + 0.05, cz - 0.2, -0.2);
        box(zone, 'book', 0.34, 0.04, 0.24, cx + 0.6, DESK_H + 0.05, cz + 0.25, 0.3);
        break;
      }
      case 'sofa': {
        // Seats sit just in front of the collider rect; the cushion reaches past the seat line.
        const seat = seatsNear(pr)[0].st;
        const f = Math.cos(seat.facing) >= 0 ? 1 : -1; // +1: seats face +z
        const back = f > 0 ? pr.z1 : pr.z2;
        const span = (t0: number, t1: number) => ({ c: back + f * (t0 + t1) / 2, len: t1 - t0 });
        const shelf = span(0, 0.6), rest = span(0.6, 0.95), cush = span(0.6, Math.abs(seat.z - back) + 0.3);
        box(zone, 'desk', w, 0.6, shelf.len, cx, 0.3, shelf.c);
        for (const bx of [-0.9, 0.1, 0.9]) box(zone, 'book', 0.22, 0.3, 0.16, cx + bx, 0.75, shelf.c, bx);
        box(zone, 'sofa', w, 0.9, rest.len, cx, 0.45, rest.c);
        box(zone, 'cushion', w - 0.3, 0.42, cush.len, cx, 0.21, cush.c);
        for (const sx of [-1, 1]) box(zone, 'sofa', 0.15, 0.62, cush.len, cx + sx * (w / 2 - 0.075), 0.31, cush.c);
        break;
      }
      case 'beanbag': {
        const seat = seatsNear(pr)[0].st;
        const bx = (cx + seat.x) / 2, bz = (cz + seat.z) / 2;
        const g = new THREE.SphereGeometry(0.55, 20, 14);
        g.scale(1, 0.5, 1);
        put(zone, 'beanbag', g, bx, 0.22, bz);
        const backG = new THREE.SphereGeometry(0.42, 16, 12);
        backG.scale(1, 0.85, 0.7);
        put(zone, 'beanbag', backG, bx - Math.sin(seat.facing) * 0.32, 0.45, bz - Math.cos(seat.facing) * 0.32);
        break;
      }
      case 'counter': {
        box(zone, 'desk', w, 0.95, d, cx, 0.475, cz);
        box(zone, 'counterTop', w + 0.04, 0.05, d + 0.04, cx, 0.975, cz);
        box(zone, 'coffee', 0.45, 0.55, 0.42, cx - 0.1, 1.275, cz);
        box(zone, 'metal', 0.06, 0.12, 0.06, cx + 0.16, 1.2, cz);           // spout
        box(zone, 'screen', 0.02, 0.12, 0.2, cx + 0.135, 1.43, cz);           // display
        for (const dz of [-0.6, -0.45]) put(zone, 'book', new THREE.CylinderGeometry(0.045, 0.038, 0.1, 12), cx + 0.3, 1.05, cz + dz);
        break;
      }
      case 'vending': {
        box(zone, 'machine', w, 1.9, d, cx, 0.95, cz);
        box(zone, 'screen', 0.04, 1.3, d - 0.3, pr.x2 + 0.02, 1.15, cz);
        box(zone, 'metal', 0.04, 0.2, d - 0.3, pr.x2 + 0.02, 0.25, cz);      // pickup slot
        break;
      }
      case 'board': {
        box(zone, 'desk', w, 0.7, d - 0.06, cx, 0.35, cz + 0.03);             // low cabinet under the board
        box(zone, 'part', w + 0.1, 1.25, 0.06, cx, 1.55, pr.z1 + 0.03);       // board frame on the wall
        break;
      }
      case 'plant': {
        put(zone, 'pot', new THREE.CylinderGeometry(0.25, 0.19, 0.45, 16), cx, 0.225, cz);
        put(zone, 'leaf', new THREE.SphereGeometry(0.42, 16, 12), cx, 0.82, cz);
        put(zone, 'leaf', new THREE.SphereGeometry(0.28, 14, 10), cx + 0.08, 1.2, cz - 0.05);
        break;
      }
    }
  }

  // Radio (no Prop in the map): a small round side table with a radio on it, at the interactable point.
  const radio = MAP.interactables.find(i => i.id === 'radio');
  if (radio) {
    const z = zoneOf(radio.x, radio.z);
    put(z, 'desk', new THREE.CylinderGeometry(0.26, 0.26, 0.04, 20), radio.x, 0.62, radio.z);
    put(z, 'metal', new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8), radio.x, 0.3, radio.z);
    put(z, 'metal', new THREE.CylinderGeometry(0.16, 0.18, 0.03, 16), radio.x, 0.015, radio.z);
    box(z, 'radio', 0.36, 0.2, 0.14, radio.x, 0.74, radio.z);
    for (const sx of [-0.08, 0.08]) {
      const g = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16);
      g.rotateX(Math.PI / 2);
      put(z, 'metal', g, radio.x + sx, 0.74, radio.z - 0.07);
    }
    box(z, 'metal', 0.012, 0.32, 0.012, radio.x + 0.17, 0.98, radio.z, 0);
  }

  // Lounge lamps: pole/base into the lounge metal bucket, shades merged into one emissive mesh below.
  const loungeShadeGeos: THREE.BufferGeometry[] = [];
  const loungeLightSpots: THREE.Vector3[] = [];
  for (const l of LOUNGE_LAMPS) {
    const z = zoneOf(l.x, l.z);
    const poleH = l.kind === 'floor' ? 1.45 : 0.3;
    const shadeH = l.kind === 'floor' ? 0.28 : 0.18;
    const [rTop, rBot] = l.kind === 'floor' ? [0.15, 0.22] : [0.09, 0.13];
    put(z, 'metal', new THREE.CylinderGeometry(rBot * 0.7, rBot * 0.8, 0.03, 16), l.x, l.baseY + 0.015, l.z);
    put(z, 'metal', new THREE.CylinderGeometry(0.015, 0.015, poleH, 8), l.x, l.baseY + poleH / 2, l.z);
    const shade = new THREE.CylinderGeometry(rTop, rBot, shadeH, 20, 1, true);
    shade.translate(l.x, l.baseY + poleH + shadeH / 2 - 0.04, l.z);
    loungeShadeGeos.push(shade);
    loungeLightSpots.push(new THREE.Vector3(l.x, l.baseY + poleH, l.z));
  }

  // ---------- materials + merged meshes ----------
  const themedMats: { m: THREE.MeshStandardMaterial; zone: ZoneId; role: ThemedRole }[] = [];
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geos);
    b.geos.forEach(g => g.dispose());
    let mat: THREE.MeshStandardMaterial;
    if (b.role === 'glass') {
      mat = new THREE.MeshStandardMaterial({
        color: 0xcfe8f5, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false,
      });
    } else {
      const fixed = (FIXED as Record<string, number>)[b.role];
      mat = new THREE.MeshStandardMaterial({ color: fixed ?? 0xffffff, roughness: 0.85 });
      if (fixed === undefined) themedMats.push({ m: mat, zone: b.zone, role: b.role as ThemedRole });
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${b.zone}:${b.role}`;
    mesh.receiveShadow = true;
    mesh.castShadow = b.role !== 'glass' && b.role !== 'floor' && b.role !== 'rug' && b.role !== 'mat';
    if (b.role === 'glass') mesh.renderOrder = 1;
    root.add(mesh);
    dim.register(b.zone, mat);
  }

  // Record board face (Task 14 draws today's stats onto it via a canvas texture) — findable by name 'board'.
  const boardProp = MAP.props.find(pr => pr.kind === 'board');
  if (boardProp) {
    const boardMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(boardProp.x2 - boardProp.x1 - 0.1, 1.1), boardMat);
    board.name = 'board';
    board.position.set((boardProp.x1 + boardProp.x2) / 2, 1.55, boardProp.z1 + 0.065);
    root.add(board);
    dim.register(zoneOf(board.position.x, board.position.z), boardMat);
  }

  // Desk lamp shades (one merged mesh) + real point lights (≤ MAX_LAMP_LIGHTS).
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.6 });
  if (shadeGeos.length) {
    const shades = new THREE.Mesh(mergeGeometries(shadeGeos), shadeMat);
    shadeGeos.forEach(g => g.dispose());
    shades.name = 'lampShades';
    root.add(shades);
    dim.register('reading', shadeMat);
  }
  const lampLights = lampSpots.slice(0, MAX_LAMP_LIGHTS).map(pos => {
    const pl = new THREE.PointLight(0xffffff, 0, 3.2, 1.6);
    pl.position.copy(pos);
    root.add(pl);
    return pl;
  });

  // Lounge lamps: shades (one merged mesh) + point lights, on only at night.
  const loungeShadeMat = new THREE.MeshStandardMaterial({ color: LOUNGE_SHADE, side: THREE.DoubleSide, roughness: 0.6 });
  const loungeShades = new THREE.Mesh(mergeGeometries(loungeShadeGeos), loungeShadeMat);
  loungeShadeGeos.forEach(g => g.dispose());
  loungeShades.name = 'loungeLampShades';
  root.add(loungeShades);
  dim.register('lounge', loungeShadeMat);
  const loungeLights = loungeLightSpots.map(pos => {
    const pl = new THREE.PointLight(0xffffff, 0, LOUNGE_LIGHT_DIST, LOUNGE_LIGHT_DECAY);
    pl.position.copy(pos);
    pl.visible = false;
    root.add(pl);
    return pl;
  });

  // ---------- lounge window (aligned to the inner face of the x=0 wall) with rain + moon ----------
  const win = MAP.windows[0];
  const wallInner = MAP.walls.reduce((acc, w) => (w.x1 < 0 && w.x2 > 0 && w.z1 <= win.z1 && w.z2 >= win.z2 ? w.x2 : acc), 0.1);
  const wx = wallInner + 0.004, wz = (win.z1 + win.z2) / 2, wLen = win.z2 - win.z1;
  const wy0 = 0.9, wy1 = 2.6, wH = wy1 - wy0, wy = (wy0 + wy1) / 2;
  const winZone = zoneOf(wx + 0.1, wz);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const winMesh = new THREE.Mesh(new THREE.PlaneGeometry(wLen, wH), winMat);
  winMesh.rotation.y = Math.PI / 2; // faces +x, into the lounge
  winMesh.position.set(wx, wy, wz);
  winMesh.name = 'window';
  root.add(winMesh);
  dim.register(winZone, winMat);
  // window frame: sill, head and a mullion every 2 m (themed 'part' colour)
  const frameGeos: THREE.BufferGeometry[] = [];
  const fbox = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(x, y, z);
    frameGeos.push(g);
  };
  fbox(0.08, 0.08, wLen + 0.16, wallInner + 0.04, wy0 - 0.04, wz);
  fbox(0.08, 0.08, wLen + 0.16, wallInner + 0.04, wy1 + 0.04, wz);
  for (let z = win.z1; z <= win.z2 + 1e-6; z += 2) fbox(0.06, wH, 0.06, wallInner + 0.03, wy, z);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const frame = new THREE.Mesh(mergeGeometries(frameGeos), frameMat);
  frameGeos.forEach(g => g.dispose());
  frame.castShadow = frame.receiveShadow = true;
  root.add(frame);
  dim.register(winZone, frameMat);

  const dropMat = new THREE.MeshBasicMaterial({ color: 0x8fa8ff, transparent: true, opacity: 0, depthWrite: false });
  const dropGeo = new THREE.PlaneGeometry(0.015, 0.22);
  dropGeo.rotateY(Math.PI / 2);
  const rain = new THREE.InstancedMesh(dropGeo, dropMat, RAIN_DROPS);
  rain.name = 'rain';
  const drops = Array.from({ length: RAIN_DROPS }, () => ({
    z: win.z1 + 0.05 + Math.random() * (wLen - 0.1),
    y: wy0 + 0.11 + Math.random() * (wH - 0.22),
    v: 1.2 + Math.random() * 1.2, // m/s
  }));
  const dm = new THREE.Matrix4();
  const writeDrops = () => {
    drops.forEach((d, i) => rain.setMatrixAt(i, dm.makeTranslation(wx + 0.004, d.y, d.z)));
    rain.instanceMatrix.needsUpdate = true;
  };
  writeDrops();
  rain.frustumCulled = false;
  root.add(rain);
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xe8ecff, transparent: true, opacity: 0 });
  const moon = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), moonMat);
  moon.rotation.y = Math.PI / 2;
  moon.position.set(wx + 0.002, wy1 - 0.4, win.z2 - 3.2);
  root.add(moon);
  dim.register(winZone, dropMat);
  dim.register(winZone, moonMat);
  let rainLevel = 0;
  let lampI = 0;
  let night = 0; // 0 by day, 1 by night; follows the theme blend (NIGHT is the only theme with rain)

  /** Light intensities and shade glow scaled by the current zone dim factors. */
  const applyLampLevels = () => {
    const fr = dim.factor('reading'), fl = dim.factor('lounge');
    shadeMat.emissiveIntensity = Math.min(lampI, 1) * 0.9 * fr;
    for (const pl of lampLights) {
      pl.intensity = lampI * fr;
      pl.visible = lampI > 0;
    }
    loungeShadeMat.emissiveIntensity = night * 0.9 * fl;
    for (const pl of loungeLights) {
      pl.intensity = LOUNGE_LIGHT_I * night * fl;
      pl.visible = night > 0.01;
    }
  };

  return {
    seatMarkers,
    applyTheme(t: Theme) {
      for (const { m, zone, role } of themedMats) dim.setBase(m, t[role], role === 'floor' ? FLOOR_TINT[zone] : 1);
      dim.setBase(frameMat, t.part);
      dim.setBase(winMat, t.win);
      dim.setBase(shadeMat, t.lamp);
      shadeMat.emissive.setHex(t.lamp);
      loungeShadeMat.emissive.setHex(t.lamp);
      for (const pl of [...lampLights, ...loungeLights]) pl.color.setHex(t.lamp);
      lampI = t.lampI;
      night = t.rain;
      applyLampLevels();
      rainLevel = t.rain;
      dropMat.opacity = 0.55 * t.rain;
      moonMat.opacity = t.rain;
      rain.visible = moon.visible = t.rain > 0.01;
    },
    update(dtMs: number) {
      applyLampLevels();
      if (rainLevel <= 0.01) return;
      const top = wy1 - 0.11, bottom = wy0 + 0.11;
      for (const d of drops) {
        d.y -= (d.v * dtMs) / 1000;
        if (d.y < bottom) d.y = top;
      }
      writeDrops();
    },
  };
}


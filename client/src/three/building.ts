// The building, built from the shared MAP. Static geometry is merged per (zone, role) so each zone/role pair is one
// draw call with its own material — that keeps draw calls low and lets ZoneDimmer dim each zone separately.
// Lamps: every lamp has an emissive shade and a fake glow (glow.ts); only the few lamps that matter most around the
// focus point (my avatar) borrow one of the LIGHT_POOL_SIZE real point lights (lightPool.ts).
// Materials are Lambert (no specular term): the look is matte anyway and it is much cheaper per fragment.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP, zoneAt, type Prop, type Rect, type Wall, type ZoneId } from '@studyverse/shared';
import { DAY, NIGHT, lerpTheme, type Theme } from './theme';
import type { ZoneDimmer } from './zoneDim';
import { LightPool, type LampSource } from './lightPool';
import { GlowLayer, glowQuad, glowTexture } from './glow';

type ThemedRole = 'floor' | 'wall' | 'desk' | 'part';
const FIXED = {
  book: 0xf2efe6, metal: 0x333333, sofa: 0xc96b4b, cushion: 0xd9806a, beanbag: 0x7c5cff,
  machine: 0x333a44, screen: 0x7fd0ff, coffee: 0x222222, counterTop: 0xe9e2d4, pot: 0x8a5a3a, leaf: 0x5aa060,
  studyChair: 0x5f7f99, radio: 0x9b6b4a, rug: 0xb5835a, mat: 0x5a4636, runner: 0xead9b8,
} as const;
type FixedRole = keyof typeof FIXED;
// 'decor': small lounge decor (books, art, pots, stools, armchair, rugs) with per-vertex colours — one material and
// one draw call per zone however many colours it uses.
type Role = ThemedRole | FixedRole | 'glass' | 'decor';
const THEMED: readonly ThemedRole[] = ['floor', 'wall', 'desk', 'part'];

/** Slight per-zone floor variation so rooms read as distinct spaces; the corridor is the lightest (v1.1). */
const FLOOR_TINT: Record<ZoneId, number> = { lounge: 1.1, corridor: 1.6, reading: 1, studyA: 1.05, studyB: 1.05 };
/** Per-zone wall brightness (the corridor's walls are a lighter plaster). */
const WALL_TINT: Record<ZoneId, number> = { lounge: 1, corridor: 1.15, reading: 1, studyA: 1, studyB: 1 };
const ZONES = Object.keys(MAP.zones) as ZoneId[];

type LampKind = 'desk' | 'lounge' | 'pendant' | 'sconce';
const DESK_LIGHT = { distance: 3.2, decay: 1.6 }; // desk lamp light (intensity = theme lampI × reading dim factor)
// Warm lounge lamps that switch on at night. Placed inside existing collider rects (sofa shelves, counter,
// board cabinet) or against a wall so players don't walk through them. `top`: the surface a table lamp stands on.
const LOUNGE_LAMPS: { x: number; z: number; baseY: number; kind: 'floor' | 'table'; top?: Rect }[] = [
  { x: 4.2, z: 9.3, baseY: 0.6, kind: 'table', top: { x1: 4, z1: 9, x2: 7, z2: 9.6 } },           // sofa 1's back shelf
  { x: 6.8, z: 14.7, baseY: 0.6, kind: 'table', top: { x1: 4, z1: 14.4, x2: 7, z2: 15 } },        // sofa 2's back shelf
  { x: 0.4, z: 2.3, baseY: 1.0, kind: 'table', top: { x1: 0.08, z1: 1.98, x2: 1.42, z2: 4.02 } }, // coffee counter
  { x: 7.15, z: 0.32, baseY: 0.7, kind: 'table', top: { x1: 5.6, z1: 0.13, x2: 7.4, z2: 0.5 } },  // board cabinet
  { x: 7.3, z: 23.6, baseY: 0, kind: 'floor' },     // by the radio, against the entrance-side wall
];
const LOUNGE_LIGHT_I = 10;    // full-night intensity (× night × lounge dim factor)
const LOUNGE_LIGHT_DIST = 8;
const LOUNGE_LIGHT_DECAY = 1.1;
const LOUNGE_SHADE = 0xf3e3c3;
// One warm pendant over each study-room table, also on only at night.
const PENDANT_Y = 2.0;        // bottom of the cord / top of the shade
const PENDANT_I = 8;          // full-night intensity (× night × that room's dim factor)
const PENDANT_DIST = 4.5;     // short range: stays inside its room (the other table is 5 m away)
// Corridor wall sconces (v1.1): emissive shade + fake glow (floor pool and a wash on the wall behind) + lamp fill.
// Never pool lights: the 6 real lights stay with the desk, lounge and pendant lamps. On by day too, softer.
// x is the corridor-side wall face; all sit on opaque wall segments, clear of doors and glass.
const SCONCES: { x: number; z: number }[] = [
  { x: 13.1, z: 2.5 }, { x: 15.9, z: 5 }, { x: 13.1, z: 7.5 }, { x: 15.9, z: 13 }, { x: 13.1, z: 17 }, { x: 13.1, z: 21.5 },
];
const SCONCE_Y = 2.05;        // shade centre
const SCONCE_DAY = 0.6;       // level by day (night = 1)
const CORRIDOR_NIGHT_KEEP = 0.45; // share of the daytime floor/wall colours the lamp-lit corridor keeps at night
const PENDANT_DECAY = 1.1;
const WALL_H = MAP.wallHeight;
const DESK_H = 0.75;
const DESK_TOP = DESK_H + 0.03;
const RAIN_DROPS = 160;
// Fake glow pools: radius (m) and centre strength k at the lamp's full night intensity, fitted to what the real
// light added (intensity × attenuation × cos / π at the pool's distance below the lamp; see glow.ts).
const GLOW = {
  deskTop: { r: 1.5, k: 3 }, deskFloor: { r: 2.4, k: 0.9 },
  loungeTop: { r: 1, k: 3 }, loungeFloor: { r: 4, k: 2.5 },
  pendantTop: { r: 2.6, k: 2.6 }, pendantFloor: { r: 4, k: 1.5 },
  sconceFloor: { r: 2.8, k: 2.2 }, sconceWall: { r: 1.8, k: 2.0 },
};
const SCONCE_WALL_SHEEN = 0.08; // untinted warm wash on the wall (shows on the dark night plaster too)
// Lamp fill: what the many lamps of a zone used to add to its walls, partitions, chairs and furniture, as an emissive
// term = surface colour × lamp colour × FILL × the zone's average lamp level (minus what the pool lights carry).
const FILL: Record<LampKind, Partial<Record<Role, number>> & { other: number }> = {
  desk: { part: 1.2, wall: 0.5, floor: 0.4, desk: 0.35, book: 0.3, metal: 0.5, other: 0.3 },
  lounge: { floor: 0.3, wall: 0.4, decor: 0.12, other: 0.4 },
  pendant: { desk: 0.3, studyChair: 0.4, book: 0.5, other: 0.15 },
  sconce: { wall: 1.1, floor: 0.7, part: 0.8, runner: 0.35, mat: 0.4, other: 0.4 },
};
// By day the room is already bright and the lamps only warm their surroundings: the uniform fill is turned down
// (less so in the corridor, whose sconces are what makes it read bright and inviting).
const FILL_DAY: Record<LampKind, number> = { desk: 0.3, lounge: 0.3, pendant: 0.3, sconce: 0.6 };
// The glow is blended after sRGB encoding, which over-brightens bright (daytime) surfaces more than dark ones.
const GLOW_DAY = 0.3;
// Matte (Lambert) surfaces have no specular term; the PBR materials used to show a soft warm sheen around lamps on
// dark surfaces. The glow pools add it back (untinted, not taken over by pool lights, which are diffuse-only now).
const SHEEN: Record<LampKind, number> = { desk: 0.01, lounge: 0.02, pendant: 0.03, sconce: 0.03 };
const GLOW_FLOOR_Y = 0.025; // just above rugs/mats (0.02)
const GLOW_LIFT = 0.003;    // above table/desk tops

export interface Building {
  applyTheme(t: Theme): void;
  seatMarkers: Map<string, THREE.Object3D>;
  /**
   * Animates the rain and keeps lamp glow / light intensities in step with zone dimming; the light pool follows
   * `focus` (the camera's focus point: my avatar). Call every frame.
   */
  update(dtMs: number, focus: { x: number; z: number }): void;
}

/** A local frame: origin (x, z), local +z = facing direction (map facing convention). */
interface Frame { x: number; z: number; facing: number }
// Lounge decor palette (muted, cafe-like).
const BOOK_COLORS = [0xc96b4b, 0x7a9e7e, 0x4f6d8f, 0xd9b26a, 0xe9e2d4, 0x8a5a7a, 0x5f7f99, 0xb5835a, 0x3f5a4a];
const POT_COLORS = [0xc0704a, 0xe9e2d4, 0x8a5a3a, 0x6f8fa8];
const ART: { bg: number; a: number; b: number }[] = [
  { bg: 0xf1e4c8, a: 0xd9805a, b: 0x7a9e7e }, { bg: 0x2f4058, a: 0xf2c46b, b: 0x6f8fa8 },
  { bg: 0xe8dccb, a: 0x4f6d8f, b: 0xc96b4b }, { bg: 0xdfe8dc, a: 0x7a9e7e, b: 0xd9b26a },
  { bg: 0xf3e9e0, a: 0x8a5a7a, b: 0xe0a46a },
];
/** Deterministic pseudo-random numbers (the decor looks the same on every load). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
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
  /** Any geometry given in a local frame (see localBox). */
  const localPut = (zone: ZoneId, role: Role, o: Frame, geo: THREE.BufferGeometry, lx: number, y: number, lz: number) => {
    const c = Math.cos(o.facing), sn = Math.sin(o.facing);
    put(zone, role, geo, o.x + lx * c + lz * sn, y, o.z - lx * sn + lz * c, o.facing);
  };
  // 'decor' geometry carries its colour per vertex (sRGB hex → linear, like material colours).
  const vc = new THREE.Color();
  const paint = (geo: THREE.BufferGeometry, hex: number) => {
    vc.setHex(hex);
    const n = geo.getAttribute('position').count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = vc.r; arr[i * 3 + 1] = vc.g; arr[i * 3 + 2] = vc.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  };
  const dput = (zone: ZoneId, hex: number, geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) =>
    put(zone, 'decor', paint(geo, hex), x, y, z, ry);
  const dlocal = (zone: ZoneId, hex: number, o: Frame, geo: THREE.BufferGeometry, lx: number, y: number, lz: number) =>
    localPut(zone, 'decor', o, paint(geo, hex), lx, y, lz);
  const dlocalBox = (zone: ZoneId, hex: number, o: Frame, sx: number, sy: number, sz: number, lx: number, y: number, lz: number) =>
    dlocal(zone, hex, o, new THREE.BoxGeometry(sx, sy, sz), lx, y, lz);
  /** A flat ellipse (rug, table top) of size w × d, thickness h. */
  const ellipse = (w: number, d: number, h: number, seg = 40) => new THREE.CylinderGeometry(0.5, 0.5, h, seg).scale(w, 1, d);
  /** A small potted plant standing on a surface at height y. */
  const smallPlant = (zone: ZoneId, o: Frame, lx: number, y: number, lz: number, rnd: () => number) => {
    dlocal(zone, POT_COLORS[Math.floor(rnd() * POT_COLORS.length)], o, new THREE.CylinderGeometry(0.07, 0.055, 0.12, 12), lx, y + 0.06, lz);
    const leaf = new THREE.SphereGeometry(0.11, 8, 6).scale(1, 0.8 + rnd() * 0.6, 1);
    localPut(zone, 'leaf', o, leaf, lx, y + 0.2, lz);
  };

  // ---------- floors ----------
  for (const [id, r] of Object.entries(MAP.zones) as [ZoneId, (typeof MAP.zones)[ZoneId]][]) {
    box(id, 'floor', r.x2 - r.x1, 0.1, r.z2 - r.z1, (r.x1 + r.x2) / 2, -0.05, (r.z1 + r.z2) / 2);
  }
  // Lounge: a big soft oval rug under the sofa group (with a darker border) and a round one in the reading nook.
  put('lounge', 'rug', ellipse(5.8, 6.4, 0.02, 56), 5.5, 0.01, 12);
  dput('lounge', 0x7a5236, ellipse(6.1, 6.7, 0.012, 56), 5.5, 0.006, 12);
  dput('lounge', 0x8fa98a, ellipse(2.3, 2.3, 0.016, 40), 5.6, 0.008, 22.75);
  box('corridor', 'mat', 2.2, 0.02, 1.0, 14.5, 0.01, 23.3);
  // Corridor: a light runner rug with dark edge stripes down its length.
  box('corridor', 'runner', 1.3, 0.012, 22, 14.5, 0.006, 11.6);
  for (const sx of [-1, 1]) box('corridor', 'mat', 0.06, 0.013, 22, 14.5 + sx * 0.55, 0.0065, 11.6);

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
  const deskLamps: { pos: THREE.Vector3; zone: ZoneId; desk: Rect }[] = [];
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
        deskLamps.push({ pos: new THREE.Vector3(cx - 0.55, DESK_H + 0.35, cz - 0.15), zone, desk: pr });
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
      case 'bigPlant': {
        put(zone, 'pot', new THREE.CylinderGeometry(0.36, 0.27, 0.62, 20), cx, 0.31, cz);
        put(zone, 'pot', new THREE.CylinderGeometry(0.035, 0.05, 0.9, 8), cx, 0.95, cz);
        put(zone, 'leaf', new THREE.SphereGeometry(0.5, 18, 14).scale(1, 0.85, 1), cx, 1.2, cz);
        put(zone, 'leaf', new THREE.SphereGeometry(0.38, 16, 12), cx + 0.12, 1.62, cz - 0.08);
        put(zone, 'leaf', new THREE.SphereGeometry(0.27, 14, 10), cx - 0.1, 1.95, cz + 0.06);
        break;
      }
      case 'bookshelf':
        buildShelf(pr, zone);
        break;
      case 'coffeeTable': {
        const rnd = seeded(7);
        put(zone, 'desk', ellipse(w, d, 0.05), cx, 0.42, cz);
        put(zone, 'desk', ellipse(w * 0.8, d * 0.75, 0.03), cx, 0.14, cz);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          put(zone, 'desk', new THREE.CylinderGeometry(0.03, 0.025, 0.4, 8), cx + sx * w * 0.3, 0.2, cz + sz * d * 0.25);
        }
        const o: Frame = { x: cx, z: cz, facing: 0 };
        dlocal(zone, 0xf2efe6, o, new THREE.CylinderGeometry(0.045, 0.038, 0.09, 12), 0.38, 0.49, 0.08);   // mug
        dlocal(zone, 0x4f6d8f, o, new THREE.CylinderGeometry(0.045, 0.038, 0.09, 12), 0.22, 0.49, -0.12);
        dlocalBox(zone, 0xc96b4b, o, 0.3, 0.035, 0.22, -0.3, 0.462, 0.02);                                 // book stack
        dlocalBox(zone, 0xe9e2d4, o, 0.26, 0.03, 0.2, -0.29, 0.495, 0.03);
        smallPlant(zone, o, 0.02, 0.445, -0.05, rnd);
        break;
      }
      case 'windowBar': {
        // Long narrow counter just under the window sill, on slim metal legs; stools are client-only decor.
        const rnd = seeded(11);
        box(zone, 'desk', w, 0.05, d, cx, 0.86, cz);
        box(zone, 'desk', 0.03, 0.1, d, pr.x2 - 0.03, 0.79, cz);                     // front apron
        for (let k = 0; k <= 4; k++) {
          put(zone, 'metal', new THREE.CylinderGeometry(0.022, 0.022, 0.84, 8), pr.x2 - 0.09, 0.42, pr.z1 + 0.2 + k * (d - 0.4) / 4);
        }
        const o: Frame = { x: cx, z: cz, facing: Math.PI / 2 };                      // local x runs along -z
        dlocal(zone, 0xf2efe6, o, new THREE.CylinderGeometry(0.045, 0.038, 0.09, 12), 3.4, 0.93, 0.05);
        dlocal(zone, 0xd9b26a, o, new THREE.CylinderGeometry(0.045, 0.038, 0.09, 12), -1.2, 0.93, 0);
        dlocalBox(zone, 0x7a9e7e, o, 0.3, 0.03, 0.22, 0.6, 0.9, 0.02);
        for (const lx of [-4.6, -2.4, 1.9, 4.8]) smallPlant(zone, o, lx, 0.885, -0.02, rnd);
        // stools along the bar (walk-through decor)
        for (let z = pr.z1 + 0.9; z < pr.z2 - 0.5; z += 1.8) {
          dput(zone, 0xd9b26a, new THREE.CylinderGeometry(0.19, 0.17, 0.07, 20), pr.x2 + 0.42, 0.66, z);
          put(zone, 'metal', new THREE.CylinderGeometry(0.022, 0.022, 0.62, 8), pr.x2 + 0.42, 0.31, z);
          put(zone, 'metal', new THREE.CylinderGeometry(0.15, 0.17, 0.02, 16), pr.x2 + 0.42, 0.01, z);
          put(zone, 'metal', new THREE.TorusGeometry(0.12, 0.012, 4, 14).rotateX(Math.PI / 2), pr.x2 + 0.42, 0.3, z);
        }
        break;
      }
      case 'armchair': {
        // Reading-nook armchair turned toward the radio (decor, not a seat).
        const r = MAP.interactables.find(i => i.id === 'radio');
        const o: Frame = { x: cx, z: cz, facing: r ? Math.atan2(r.x - cx, r.z - cz) : 0 };
        const sage = 0x8fa07a, sageDark = 0x74865f;
        dlocalBox(zone, sageDark, o, 0.86, 0.34, 0.8, 0, 0.21, 0);                   // base
        dlocalBox(zone, sage, o, 0.62, 0.14, 0.66, 0, 0.44, 0.06);                   // seat cushion
        dlocal(zone, sage, o, new THREE.CapsuleGeometry(0.11, 0.62, 4, 12).rotateZ(Math.PI / 2), 0, 0.82, -0.31); // back roll
        dlocalBox(zone, sageDark, o, 0.86, 0.5, 0.2, 0, 0.58, -0.32);                // back
        for (const sx of [-1, 1]) {
          dlocal(zone, sage, o, new THREE.CapsuleGeometry(0.08, 0.64, 4, 10).rotateX(Math.PI / 2), sx * 0.37, 0.56, 0); // arm rolls
        }
        dlocalBox(zone, 0xe9e2d4, o, 0.34, 0.1, 0.3, -0.12, 0.56, -0.12);            // cushion
        dlocalBox(zone, 0xc96b4b, o, 0.24, 0.03, 0.17, 0.1, 0.525, 0.12);            // a book left on the seat
        break;
      }
    }
  }

  // ---------- lounge wall decor (client-only): framed art and a wall clock ----------
  const artOn = (o: Frame, w: number, h: number, y: number, art: (typeof ART)[number], zone: ZoneId = 'lounge') => {
    localBox(zone, 'part', o, w + 0.08, h + 0.08, 0.035, 0, y, 0.018);
    dlocalBox(zone, art.bg, o, w, h, 0.012, 0, y, 0.04);
    dlocal(zone, art.a, o, new THREE.CylinderGeometry(Math.min(w, h) * 0.22, Math.min(w, h) * 0.22, 0.01, 24).rotateX(Math.PI / 2),
      w * 0.18, y + h * 0.14, 0.05);
    dlocalBox(zone, art.b, o, w * 0.9, h * 0.3, 0.01, 0, y - h * 0.3, 0.05);
  };
  artOn({ x: 9.7, z: 23.9, facing: Math.PI }, 0.9, 0.68, 1.75, ART[0]);   // entrance-side wall
  artOn({ x: 11.05, z: 23.9, facing: Math.PI }, 0.52, 0.74, 1.62, ART[1]);
  artOn({ x: 0.1, z: 3.0, facing: Math.PI / 2 }, 1.0, 0.6, 2.05, ART[2]);  // above the coffee machine
  artOn({ x: 12.9, z: 9.0, facing: -Math.PI / 2 }, 0.56, 0.78, 1.7, ART[3]); // by the lounge door
  artOn({ x: 0.1, z: 21.6, facing: Math.PI / 2 }, 0.7, 0.9, 1.6, ART[4]);  // reading nook
  {
    const o: Frame = { x: 6.5, z: 0.1, facing: 0 }, y = 2.55;                 // wall clock above the record board
    const disc = (r: number, t: number) => new THREE.CylinderGeometry(r, r, t, 32).rotateX(Math.PI / 2);
    localPut('lounge', 'part', o, disc(0.24, 0.05), 0, y, 0.025);
    dlocal('lounge', 0xf6f0e2, o, disc(0.205, 0.012), 0, y, 0.056);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, len = k % 3 ? 0.018 : 0.035;
      dlocal('lounge', 0x3a2a20, o, new THREE.BoxGeometry(0.01, len, 0.006).rotateZ(-a).translate(Math.sin(a) * 0.17, Math.cos(a) * 0.17, 0), 0, y, 0.064);
    }
    const hand = (len: number, wd: number, a: number) => new THREE.BoxGeometry(wd, len, 0.006).translate(0, len / 2 - 0.02, 0).rotateZ(-a);
    dlocal('lounge', 0x2a2a2a, o, hand(0.11, 0.018, ((10 + 10 / 60) / 12) * Math.PI * 2), 0, y, 0.068); // 10:10
    dlocal('lounge', 0x2a2a2a, o, hand(0.16, 0.012, (10 / 60) * Math.PI * 2), 0, y, 0.072);
    dlocal('lounge', 0xc96b4b, o, disc(0.014, 0.012), 0, y, 0.078);
  }

  /** Bookshelf against a wall: wooden carcass with shelves of books, small plants and odds and ends. */
  function buildShelf(pr: Prop, zone: ZoneId): void {
    const r = MAP.zones[zone];
    const cx = (pr.x1 + pr.x2) / 2, cz = (pr.z1 + pr.z2) / 2;
    // which wall it stands against → it faces away from it
    const gaps = [pr.z1 - r.z1, r.z2 - pr.z2, pr.x1 - r.x1, r.x2 - pr.x2];
    const side = gaps.indexOf(Math.min(...gaps));
    const facing = [0, Math.PI, Math.PI / 2, -Math.PI / 2][side];
    const alongX = side < 2;
    const W = alongX ? pr.x2 - pr.x1 : pr.z2 - pr.z1, D = alongX ? pr.z2 - pr.z1 : pr.x2 - pr.x1;
    const tall = W > 2.2;
    const H = tall ? 1.85 : 0.95;
    const o: Frame = { x: cx, z: cz, facing };
    const rnd = seeded(Math.round(cx * 31 + cz * 17));
    localBox(zone, 'desk', o, W, H, 0.03, 0, H / 2, -D / 2 + 0.015);                       // back
    for (const sx of [-1, 1]) localBox(zone, 'desk', o, 0.05, H, D, sx * (W / 2 - 0.025), H / 2, 0); // sides
    const units = Math.max(1, Math.round(W / 1.6));                                          // uprights every ~1.6 m
    for (let u = 1; u < units; u++) localBox(zone, 'desk', o, 0.035, H, D - 0.03, -W / 2 + (u * W) / units, H / 2, 0.015);
    const levels = tall ? [0.05, 0.5, 0.95, 1.4, H - 0.02] : [0.05, 0.5, H - 0.02];
    for (const y of levels) localBox(zone, 'desk', o, W - 0.02, 0.035, D, 0, y, 0);
    for (let li = 0; li < levels.length - 1; li++) {
      const y0 = levels[li] + 0.0175, room = levels[li + 1] - levels[li] - 0.06;
      let lx = -W / 2 + 0.07;
      while (lx < W / 2 - 0.1) {
        const pick = rnd();
        if (pick < 0.72) { // a run of books
          const n = 3 + Math.floor(rnd() * 8);
          for (let b = 0; b < n && lx < W / 2 - 0.08; b++) {
            const t = 0.035 + rnd() * 0.04, h = Math.min(room, 0.2 + rnd() * 0.14), dep = 0.16 + rnd() * 0.07;
            dlocalBox(zone, BOOK_COLORS[Math.floor(rnd() * BOOK_COLORS.length)], o, t, h, dep, lx + t / 2, y0 + h / 2, -D / 2 + 0.03 + dep / 2);
            lx += t + 0.004;
          }
          lx += 0.02;
        } else if (pick < 0.84) { // a small plant
          lx += 0.1;
          smallPlant(zone, o, lx, y0, 0, rnd);
          lx += 0.14;
        } else if (pick < 0.93) { // a lying stack
          const n = 2 + Math.floor(rnd() * 3);
          for (let b = 0; b < n; b++) {
            dlocalBox(zone, BOOK_COLORS[Math.floor(rnd() * BOOK_COLORS.length)], o, 0.24 - b * 0.015, 0.035, 0.19, lx + 0.13, y0 + 0.0175 + b * 0.036, -0.01);
          }
          lx += 0.3;
        } else {
          lx += 0.12 + rnd() * 0.2; // gap
        }
      }
    }
    // plants on top
    const top = H + 0.0175;
    smallPlant(zone, o, -W / 2 + 0.3, top, 0, rnd);
    if (tall) smallPlant(zone, o, W / 2 - 0.35, top, 0, rnd);
    else dlocalBox(zone, 0x4f6d8f, o, 0.26, 0.04, 0.2, W / 2 - 0.35, top + 0.02, 0);
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

  // Study-room pendants: cord into the room's metal bucket; shade gets its own material (dimmed per room).
  const pendants: { zone: ZoneId; shade: THREE.BufferGeometry; pos: THREE.Vector3; table: Rect }[] = [];
  for (const pr of MAP.props.filter(pp => pp.kind === 'table')) {
    const cx = (pr.x1 + pr.x2) / 2, cz = (pr.z1 + pr.z2) / 2, zone = zoneOf(cx, cz);
    put(zone, 'metal', new THREE.CylinderGeometry(0.008, 0.008, WALL_H - PENDANT_Y, 6), cx, (WALL_H + PENDANT_Y) / 2, cz);
    const shade = new THREE.CylinderGeometry(0.07, 0.3, 0.22, 24, 1, true);
    shade.translate(cx, PENDANT_Y - 0.11, cz);
    pendants.push({ zone, shade, pos: new THREE.Vector3(cx, PENDANT_Y - 0.25, cz), table: pr });
  }

  // Corridor sconces: backplate + arm into the corridor metal bucket; shades merged into one emissive mesh below.
  const sconceShadeGeos: THREE.BufferGeometry[] = [];
  for (const sc of SCONCES) {
    const n = sc.x < 14.5 ? 1 : -1; // into the corridor
    box('corridor', 'metal', 0.03, 0.24, 0.13, sc.x + n * 0.015, SCONCE_Y - 0.06, sc.z);
    box('corridor', 'metal', 0.15, 0.02, 0.02, sc.x + n * 0.09, SCONCE_Y - 0.1, sc.z);
    const shade = new THREE.CylinderGeometry(0.1, 0.13, 0.22, 20, 1, true);
    shade.translate(sc.x + n * 0.18, SCONCE_Y, sc.z);
    sconceShadeGeos.push(shade);
    put('corridor', 'decor', paint(new THREE.SphereGeometry(0.05, 10, 8), 0xfff1d6), sc.x + n * 0.18, SCONCE_Y - 0.06, sc.z);
  }

  // ---------- materials + merged meshes ----------
  const themedMats: { m: THREE.MeshLambertMaterial; zone: ZoneId; role: ThemedRole }[] = [];
  const zoneMats: { m: THREE.MeshLambertMaterial; zone: ZoneId; role: Role }[] = []; // for the lamp fill
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geos);
    b.geos.forEach(g => g.dispose());
    let mat: THREE.MeshLambertMaterial;
    if (b.role === 'glass') {
      mat = new THREE.MeshLambertMaterial({ color: 0xcfe8f5, transparent: true, opacity: 0.28, depthWrite: false });
    } else if (b.role === 'decor') {
      mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      zoneMats.push({ m: mat, zone: b.zone, role: b.role });
    } else {
      const fixed = (FIXED as Record<string, number>)[b.role];
      mat = new THREE.MeshLambertMaterial({ color: fixed ?? 0xffffff });
      if (fixed === undefined) themedMats.push({ m: mat, zone: b.zone, role: b.role as ThemedRole });
      zoneMats.push({ m: mat, zone: b.zone, role: b.role });
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${b.zone}:${b.role}`;
    mesh.receiveShadow = true;
    mesh.castShadow = b.role !== 'glass' && b.role !== 'floor' && b.role !== 'rug' && b.role !== 'mat' && b.role !== 'runner';
    if (b.role === 'glass') mesh.renderOrder = 1;
    root.add(mesh);
    dim.register(b.zone, mat);
  }

  // Record board face (Task 14 draws today's stats onto it via a canvas texture) — findable by name 'board'.
  const boardProp = MAP.props.find(pr => pr.kind === 'board');
  if (boardProp) {
    const boardMat = new THREE.MeshLambertMaterial({ color: 0xf2efe6 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(boardProp.x2 - boardProp.x1 - 0.1, 1.1), boardMat);
    board.name = 'board';
    board.position.set((boardProp.x1 + boardProp.x2) / 2, 1.55, boardProp.z1 + 0.065);
    root.add(board);
    dim.register(zoneOf(board.position.x, board.position.z), boardMat);
  }

  // Desk lamp shades (one merged mesh).
  const shadeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  if (shadeGeos.length) {
    const shades = new THREE.Mesh(mergeGeometries(shadeGeos), shadeMat);
    shadeGeos.forEach(g => g.dispose());
    shades.name = 'lampShades';
    root.add(shades);
    dim.register('reading', shadeMat);
  }

  // Lounge lamp shades (one merged mesh) and study-room pendant shades (one per room, dimmed per room).
  const loungeShadeMat = new THREE.MeshLambertMaterial({ color: LOUNGE_SHADE, side: THREE.DoubleSide });
  const loungeShades = new THREE.Mesh(mergeGeometries(loungeShadeGeos), loungeShadeMat);
  loungeShadeGeos.forEach(g => g.dispose());
  loungeShades.name = 'loungeLampShades';
  root.add(loungeShades);
  dim.register('lounge', loungeShadeMat);
  const pendantMats = pendants.map(pd => {
    const mat = new THREE.MeshLambertMaterial({ color: LOUNGE_SHADE, side: THREE.DoubleSide });
    const shade = new THREE.Mesh(pd.shade, mat);
    shade.name = `pendant:${pd.zone}`;
    root.add(shade);
    dim.register(pd.zone, mat);
    return mat;
  });
  const sconceShadeMat = new THREE.MeshLambertMaterial({ color: LOUNGE_SHADE, side: THREE.DoubleSide });
  const sconceShades = new THREE.Mesh(mergeGeometries(sconceShadeGeos), sconceShadeMat);
  sconceShadeGeos.forEach(g => g.dispose());
  sconceShades.name = 'corridorSconces';
  root.add(sconceShades);
  dim.register('corridor', sconceShadeMat);

  // Every lamp is a light-pool source with its glow pools. Levels are recomputed every frame (applyLampLevels).
  type GlowSpec = { r: number; k: number };
  const lamps: { kind: LampKind; zone: ZoneId; zi: number; glows: { id: number; g: GlowSpec }[] }[] = [];
  const sources: LampSource[] = [];
  const glow = new GlowLayer(root, glowTexture());
  const ZONE_LAMP: Record<ZoneId, LampKind> = {
    reading: 'desk', lounge: 'lounge', studyA: 'pendant', studyB: 'pendant', corridor: 'sconce',
  };
  // Glow surfaces (tinted with the surface colour, like real diffuse light): desk-coloured tops, per-zone floors.
  const FLOOR = (z: ZoneId) => `floor:${z}`;
  const addLamp = (kind: LampKind, zone: ZoneId, pos: THREE.Vector3, light: { distance: number; decay: number },
    pools: { g: GlowSpec; clip: Rect; y: number; surface: string }[]) => {
    sources.push({ x: pos.x, y: pos.y, z: pos.z, distance: light.distance, decay: light.decay, intensity: 0 });
    const glows: { id: number; g: GlowSpec }[] = [];
    for (const p of pools) {
      const q = glowQuad(pos.x, pos.z, p.g.r, p.clip);
      if (q) glows.push({ id: glow.add(zone, q, p.y, p.surface), g: p.g });
    }
    lamps.push({ kind, zone, zi: ZONES.indexOf(zone), glows });
  };
  for (const d of deskLamps) {
    addLamp('desk', d.zone, d.pos, DESK_LIGHT, [
      { g: GLOW.deskTop, clip: d.desk, y: DESK_TOP + GLOW_LIFT, surface: 'desk' },
      { g: GLOW.deskFloor, clip: MAP.zones[d.zone], y: GLOW_FLOOR_Y, surface: FLOOR(d.zone) },
    ]);
  }
  LOUNGE_LAMPS.forEach((l, i) => {
    const zone = zoneOf(l.x, l.z);
    addLamp('lounge', zone, loungeLightSpots[i], { distance: LOUNGE_LIGHT_DIST, decay: LOUNGE_LIGHT_DECAY }, [
      ...(l.top ? [{ g: GLOW.loungeTop, clip: l.top, y: l.baseY + GLOW_LIFT, surface: l.baseY >= 1 ? 'counterTop' : 'desk' }] : []),
      { g: GLOW.loungeFloor, clip: MAP.zones[zone], y: GLOW_FLOOR_Y, surface: FLOOR(zone) },
    ]);
  });
  for (const pd of pendants) {
    addLamp('pendant', pd.zone, pd.pos, { distance: PENDANT_DIST, decay: PENDANT_DECAY }, [
      { g: GLOW.pendantTop, clip: pd.table, y: DESK_TOP + GLOW_LIFT, surface: 'desk' },
      { g: GLOW.pendantFloor, clip: MAP.zones[pd.zone], y: GLOW_FLOOR_Y, surface: FLOOR(pd.zone) },
    ]);
  }
  // Corridor sconces: glow only (floor pool + wash on the wall segment behind), all at one corridor-wide level.
  const sconceGlows: { id: number; g: GlowSpec; sheen: number }[] = [];
  const CORRIDOR = MAP.zones.corridor;
  for (const sc of SCONCES) {
    const n = sc.x < 14.5 ? 1 : -1;
    const fq = glowQuad(sc.x + n * 0.18, sc.z, GLOW.sconceFloor.r, CORRIDOR);
    if (fq) sconceGlows.push({ id: glow.add('corridor', fq, GLOW_FLOOR_Y, FLOOR('corridor')), g: GLOW.sconceFloor, sheen: SHEEN.sconce });
    const wallX = sc.x - n * 0.1; // wall centre line
    const seg = MAP.walls.find(w => !w.glass && Math.abs((w.x1 + w.x2) / 2 - wallX) < 0.01 && w.z1 <= sc.z && w.z2 >= sc.z);
    const wq = seg && glowQuad(sc.z, SCONCE_Y, GLOW.sconceWall.r, { x1: seg.z1, z1: 0, x2: seg.z2, z2: WALL_H });
    if (wq) sconceGlows.push({ id: glow.addWall('corridor', sc.x + n * 0.006, wq, 'wall:corridor'), g: GLOW.sconceWall, sheen: SCONCE_WALL_SHEEN });
  }
  glow.build();
  glow.setSurface('counterTop', FIXED.counterTop);
  const pool = new LightPool(root);
  const fills = zoneMats.map(({ m, zone, role }) => {
    const kind = ZONE_LAMP[zone];
    return { m, zi: ZONES.indexOf(zone), k: FILL[kind][role] ?? FILL[kind].other, day: FILL_DAY[kind] };
  });
  const CORRIDOR_ZI = ZONES.indexOf('corridor');
  const zoneLevel = new Float64Array(ZONES.length), zoneLamps = new Float64Array(ZONES.length);
  for (const l of lamps) zoneLamps[l.zi]++;
  const lampColor = new THREE.Color();

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
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
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
    for (let i = 0; i < drops.length; i++) rain.setMatrixAt(i, dm.makeTranslation(wx + 0.004, drops[i].y, drops[i].z));
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

  /** Lamp levels (theme × zone dim) → light pool, shade emission and fake glow (minus the share the pool carries). */
  const FULL: Record<LampKind, number> = { desk: NIGHT.lampI, lounge: LOUNGE_LIGHT_I, pendant: PENDANT_I, sconce: 1 };
  let focusX = MAP.width / 2, focusZ = MAP.depth / 2;
  const applyLampLevels = (dtMs: number) => {
    const fr = dim.factor('reading'), fl = dim.factor('lounge');
    shadeMat.emissiveIntensity = Math.min(lampI, 1) * 0.9 * fr;
    loungeShadeMat.emissiveIntensity = night * 0.9 * fl;
    for (let i = 0; i < pendants.length; i++) pendantMats[i].emissiveIntensity = night * 0.9 * dim.factor(pendants[i].zone);
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      const level = l.kind === 'desk' ? lampI : l.kind === 'lounge' ? LOUNGE_LIGHT_I * night : PENDANT_I * night;
      sources[i].intensity = level * dim.factor(l.zone);
    }
    pool.update(sources, focusX, focusZ, dtMs);
    zoneLevel.fill(0);
    const glowScale = night + (1 - night) * GLOW_DAY;
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      const level = sources[i].intensity / FULL[l.kind];
      const unpooled = level * (1 - pool.share(i, sources));
      zoneLevel[l.zi] += unpooled / zoneLamps[l.zi];
      // × dim factor once more: the real light's contribution also scaled with the dimmed surface colour
      const g = unpooled * dim.factor(l.zone) * glowScale, sheen = level * SHEEN[l.kind] * glowScale;
      for (let j = 0; j < l.glows.length; j++) glow.set(l.glows[j].id, l.glows[j].g.k * g, l.glows[j].g.k * sheen);
    }
    // corridor sconces: one level for all (theme × corridor dim), never pooled
    const fc = dim.factor('corridor');
    const sconce = (night + (1 - night) * SCONCE_DAY) * fc;
    sconceShadeMat.emissiveIntensity = sconce * 0.95;
    zoneLevel[CORRIDOR_ZI] = sconce;
    for (let j = 0; j < sconceGlows.length; j++) {
      const s = sconceGlows[j];
      glow.set(s.id, s.g.k * sconce * fc * glowScale, s.g.k * s.sheen * sconce * glowScale);
    }
    glow.flush();
    // material colours are already dimmed (× factor), so the fill scales with the factor twice, like the glow
    for (let i = 0; i < fills.length; i++) {
      const f = fills[i];
      const dayScale = night + (1 - night) * f.day;
      f.m.emissive.copy(f.m.color).multiply(lampColor).multiplyScalar(f.k * dayScale * zoneLevel[f.zi]);
    }
  };

  return {
    seatMarkers,
    applyTheme(t: Theme) {
      // The lit corridor keeps part of its daytime plaster and wood at night instead of going lofi-dark.
      const lit = lerpTheme(t, DAY, CORRIDOR_NIGHT_KEEP * t.rain);
      for (const { m, zone, role } of themedMats) {
        const c = zone === 'corridor' ? lit : t;
        dim.setBase(m, c[role], role === 'floor' ? FLOOR_TINT[zone] : role === 'wall' ? WALL_TINT[zone] : 1);
      }
      sconceShadeMat.emissive.setHex(t.lamp);
      glow.setSurface('wall:corridor', lit.wall, WALL_TINT.corridor);
      dim.setBase(frameMat, t.part);
      dim.setBase(winMat, t.win);
      dim.setBase(shadeMat, t.lamp);
      shadeMat.emissive.setHex(t.lamp);
      loungeShadeMat.emissive.setHex(t.lamp);
      for (const mat of pendantMats) mat.emissive.setHex(t.lamp);
      pool.setColor(t.lamp);
      glow.setColor(t.lamp);
      lampColor.setHex(t.lamp);
      glow.setSurface('desk', t.desk);
      for (const z of ZONES) glow.setSurface(FLOOR(z), (z === 'corridor' ? lit : t).floor, FLOOR_TINT[z]);
      lampI = t.lampI;
      night = t.rain;
      applyLampLevels(0);
      rainLevel = t.rain;
      dropMat.opacity = 0.55 * t.rain;
      moonMat.opacity = t.rain;
      rain.visible = moon.visible = t.rain > 0.01;
    },
    update(dtMs: number, focus: { x: number; z: number }) {
      focusX = focus.x;
      focusZ = focus.z;
      applyLampLevels(dtMs);
      if (rainLevel <= 0.01) return;
      const top = wy1 - 0.11, bottom = wy0 + 0.11;
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        d.y -= (d.v * dtMs) / 1000;
        if (d.y < bottom) d.y = top;
      }
      writeDrops();
    },
  };
}


// Building map data + spatial queries. Shared by server (zones, movement, seats) and client (render, collision).
// Units: metres. x runs left->right, z runs back->entrance (entrance at z=37).
// Facing convention: forward = (sin(facing), cos(facing)) in (x, z); facing 0 looks +z, PI looks -z.
//
// Plan (v2): a main corridor (x 20–25) runs from the entrance to the back wall with a mirrored wing on each side.
// From the back: a reading room, two study rooms, a cross hall (z 21–25, open to the main corridor; the study rooms'
// doors open onto it, and its walls are glass on both sides) and, by the entrance, the sofa lounge (west) and the cafe lounge (east). Everything in the east
// wing is placed relative to E (its west edge), everything in the lounges relative to LZ (their north edge), so the
// corridor and the halls can be resized by changing CX2 / HALL_Z2 alone.
//
//   z=0  ┌──────────────────┬─────┬──────────────────┐
//        │ reading (R01–24) │     │ readingB (R25–48)│
//   z=14 ├────────┬─────────┤  c  ├────────┬─────────┤
//        │ studyA │ studyB  │  o  │ studyC │ studyD  │
//   z=21 ├──door──┴──door───┤  r  ├──door──┴──door───┤
//        │      hallW          r         hallE       │
//   z=25 ├──────door────────┤  i  ├──────door────────┤
//        │ lounge (sofas)   d  d  d  cafe (coffee)   │
//   z=37 └──────────────────┴entr.┴──────────────────┘
//        x=0               20    25                 45

export type ZoneId = 'lounge' | 'cafe' | 'corridor' | 'hallW' | 'hallE' | 'reading' | 'readingB'
  | 'studyA' | 'studyB' | 'studyC' | 'studyD';
/** What a zone behaves like (break rules, lamps, dimming, occupancy lights). */
export type ZoneKind = 'lounge' | 'corridor' | 'reading' | 'study';
export const ZONE_KIND: Record<ZoneId, ZoneKind> = {
  lounge: 'lounge', cafe: 'lounge', corridor: 'corridor', hallW: 'corridor', hallE: 'corridor',
  reading: 'reading', readingB: 'reading', studyA: 'study', studyB: 'study', studyC: 'study', studyD: 'study',
};
/** Kind of a zone; null (outside the building) stays null. */
export function zoneKind(z: ZoneId | null): ZoneKind | null {
  return z === null ? null : ZONE_KIND[z];
}
export interface Rect { x1: number; z1: number; x2: number; z2: number }
export type SeatKind = 'desk' | 'studyChair' | 'sofa';
export interface Seat { id: string; zone: ZoneId; kind: SeatKind; x: number; z: number; facing: number }
export type InteractableId = 'coffee' | 'vending' | 'radio' | 'board';
export interface Interactable { id: InteractableId; x: number; z: number }
export interface Wall extends Rect { glass: boolean }
export interface Prop extends Rect {
  kind: 'desk' | 'table' | 'counter' | 'vending' | 'sofa' | 'beanbag' | 'board' | 'plant'
    | 'bookshelf' | 'coffeeTable' | 'windowBar' | 'bigPlant' | 'armchair'
    | 'cabinet' | 'coatRack' | 'tvStand';
}

const T = 0.1; // half wall thickness (thickness 0.2)
const WING = 20;                        // width of each wing
const CX1 = WING, CX2 = CX1 + 5;        // main corridor (5 m)
const E = CX2;                          // east wing's west edge
const W = E + WING;                     // building width
const READ_Z = 14, HALL_Z1 = 21, HALL_Z2 = HALL_Z1 + 4; // reading | study, study | hall, hall (4 m) | lounge
const LZ = HALL_Z2;                     // lounges' north edge
const D = LZ + 12;                      // building depth (the lounges are 12 m deep)
const CMX = (CX1 + CX2) / 2;            // corridor centre line

const vWall = (x: number, z1: number, z2: number, glass = false): Wall =>
  ({ x1: x - T, z1, x2: x + T, z2, glass });
const hWall = (z: number, x1: number, x2: number, glass = false): Wall =>
  ({ x1, z1: z - T, x2, z2: z + T, glass });
const box = (kind: Prop['kind'], cx: number, cz: number, w: number, d: number): Prop =>
  ({ kind, x1: cx - w / 2, z1: cz - d / 2, x2: cx + w / 2, z2: cz + d / 2 });
const rect = (kind: Prop['kind'], x1: number, z1: number, x2: number, z2: number): Prop =>
  ({ kind, x1, z1, x2, z2 });

const zones: Record<ZoneId, Rect> = {
  reading: { x1: 0, z1: 0, x2: CX1, z2: READ_Z },
  readingB: { x1: E, z1: 0, x2: W, z2: READ_Z },
  studyA: { x1: 0, z1: READ_Z, x2: 10, z2: HALL_Z1 },
  studyB: { x1: 10, z1: READ_Z, x2: CX1, z2: HALL_Z1 },
  studyC: { x1: E, z1: READ_Z, x2: E + 10, z2: HALL_Z1 },
  studyD: { x1: E + 10, z1: READ_Z, x2: W, z2: HALL_Z1 },
  hallW: { x1: 0, z1: HALL_Z1, x2: CX1, z2: HALL_Z2 },
  hallE: { x1: E, z1: HALL_Z1, x2: W, z2: HALL_Z2 },
  lounge: { x1: 0, z1: LZ, x2: CX1, z2: D },
  cafe: { x1: E, z1: LZ, x2: W, z2: D },
  corridor: { x1: CX1, z1: 0, x2: CX2, z2: D },
};

// Study-room doors (2 m, on the hall wall z=21), at the end of each room nearer the main corridor.
const STUDY_DOORS: Record<'studyA' | 'studyB' | 'studyC' | 'studyD', [number, number]> = {
  studyA: [7, 9], studyB: [17, 19], studyC: [E + 1, E + 3], studyD: [E + 11, E + 13],
};

const walls: Wall[] = [
  // outer
  vWall(0, 0, D), vWall(W, 0, D),
  hWall(0, -T, W + T),
  hWall(D, -T, CX1), hWall(D, CX2, W + T), // entrance gap: the corridor's width
  // main corridor walls: reading doors z10-12, study rooms glass (no door), open to the halls, lounge/cafe doors
  // LZ+4 .. LZ+8
  ...[CX1, CX2].flatMap(x => [
    vWall(x, 0, 10), vWall(x, 12, READ_Z), vWall(x, READ_Z, HALL_Z1, true), vWall(x, LZ, LZ + 4), vWall(x, LZ + 8, D),
  ]),
  // reading | study rooms; study A | B and C | D
  hWall(READ_Z, 0, CX1), hWall(READ_Z, E, W),
  vWall(10, READ_Z, HALL_Z1), vWall(E + 10, READ_Z, HALL_Z1),
  // study rooms | halls (z=21), glass with one door per room
  hWall(HALL_Z1, 0, 7, true), hWall(HALL_Z1, 9, 17, true), hWall(HALL_Z1, 19, CX1, true),
  hWall(HALL_Z1, E, E + 1, true), hWall(HALL_Z1, E + 3, E + 11, true), hWall(HALL_Z1, E + 13, W, true),
  // halls | lounges, glass: lounge door x9-12, cafe door E+8 .. E+11
  hWall(LZ, 0, 9, true), hWall(LZ, 12, CX1, true),
  hWall(LZ, E, E + 8, true), hWall(LZ, E + 11, W, true),
];

const DESK_W = 1.6, DESK_D = 0.8;
const props: Prop[] = [];
const seats: Seat[] = [];
const interactables: Interactable[] = [
  { id: 'coffee', x: E + 1.0, z: LZ + 1.9 },
  { id: 'vending', x: E + 1.0, z: LZ + 10.0 },
  { id: 'radio', x: 17.5, z: LZ + 10.6 },
  { id: 'board', x: 3.5, z: LZ + 0.4 },
];

// Reading rooms: 6 columns x 4 rows of desks on a 3 m pitch (1.4 m between desks, ~1.4 m lane behind the chairs,
// ~2 m aisle along the corridor wall); chair is 0.85 behind (+z) the desk centre, facing the desk (-z). Columns count
// outward from the corridor, so R01/R25 are the desks nearest the door.
for (const [zone, x0, dir, first] of [['reading', CX1 - 2.8, -1, 1], ['readingB', E + 2.8, 1, 25]] as const) {
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 6; i++) {
      const cx = x0 + dir * 3.0 * i, cz = 2.0 + 3.0 * j;
      props.push(box('desk', cx, cz, DESK_W, DESK_D));
      seats.push({ id: `R${String(first + j * 6 + i).padStart(2, '0')}`, zone, kind: 'desk', x: cx, z: cz + 0.85, facing: Math.PI });
    }
  }
}

// Study rooms (10 × 7 m): one 3x1.2 table in the middle, 3 chairs per long side facing it.
const STUDY_ROOMS = [['A', 'studyA'], ['B', 'studyB'], ['C', 'studyC'], ['D', 'studyD']] as const;
for (const [prefix, zone] of STUDY_ROOMS) {
  const r = zones[zone], cx = (r.x1 + r.x2) / 2, cz = (r.z1 + r.z2) / 2;
  props.push(box('table', cx, cz, 3, 1.2));
  [cx - 1.5, cx, cx + 1.5].forEach((x, k) => {
    seats.push({ id: `${prefix}${k + 1}`, zone, kind: 'studyChair', x, z: cz - 1.05, facing: 0 });
    seats.push({ id: `${prefix}${k + 4}`, zone, kind: 'studyChair', x, z: cz + 1.05, facing: Math.PI });
  });
}

// Study-room furniture. Every room: a low bookshelf and a low cabinet against the north wall, a coat rack in the corner
// beside its door, a big plant in the opposite south corner, a monitor on a floor stand facing the table from in front
// of the glass hall wall. The whiteboard (north wall), the clock and the rug are client-only. Everything sits clear of the door, the chairs and the walk
// round the table (see map.test.ts).
for (const [, zone] of STUDY_ROOMS) {
  const r = zones[zone], north = r.z1 + 0.1, south = r.z2 - 0.1;
  const [d1, d2] = STUDY_DOORS[zone];
  const doorEast = d1 - r.x1 > r.x2 - d2; // the door is in the room's east half
  const [shelfX, cabX] = doorEast ? [r.x1 + 0.6, r.x2 - 2.4] : [r.x2 - 2.6, r.x1 + 0.6];
  props.push(
    rect('bookshelf', shelfX, north, shelfX + 2.0, north + 0.4),
    rect('cabinet', cabX, north, cabX + 1.8, north + 0.45),
    box('coatRack', doorEast ? r.x2 - 0.45 : r.x1 + 0.45, south - 0.35, 0.5, 0.5),
    box('bigPlant', doorEast ? r.x1 + 0.65 : r.x2 - 0.65, south - 0.55, 0.8, 0.8),
    box('tvStand', (r.x1 + r.x2) / 2, south - 0.35, 0.8, 0.5),
  );
}

// Sofa lounge (west, x 0–20): two 3-seat sofas facing each other across a walkway, two beanbags. Seats sit just in
// front of each piece.
props.push(rect('sofa', 5, LZ + 3, 8, LZ + 4));    // S1-S3, seats face +z
props.push(rect('sofa', 5, LZ + 8, 8, LZ + 9));    // S4-S6, seats face -z
props.push(rect('beanbag', 10.1, LZ + 3.6, 10.9, LZ + 4.4));  // S7, seat faces +z
props.push(rect('beanbag', 10.1, LZ + 7.6, 10.9, LZ + 8.4));  // S8, seat faces -z
[5.5, 6.5, 7.5].forEach((x, k) => {
  seats.push({ id: `S${k + 1}`, zone: 'lounge', kind: 'sofa', x, z: LZ + 4.5, facing: 0 });
  seats.push({ id: `S${k + 4}`, zone: 'lounge', kind: 'sofa', x, z: LZ + 7.5, facing: Math.PI });
});
seats.push({ id: 'S7', zone: 'lounge', kind: 'sofa', x: 10.5, z: LZ + 5.0, facing: 0 });
seats.push({ id: 'S8', zone: 'lounge', kind: 'sofa', x: 10.5, z: LZ + 7.0, facing: Math.PI });

// Fixtures (rects contain their interactable point; interaction happens from the open side). The record board hangs on
// the lounge's north wall; the coffee counter and the vending machine stand against the cafe's corridor wall.
props.push(rect('board', 2.6, LZ + 0.1, 4.4, LZ + 0.5));
props.push(rect('counter', E + 0.1, LZ + 0.9, E + 1.4, LZ + 2.9));
props.push(rect('vending', E + 0.1, LZ + 9.4, E + 1.3, LZ + 10.6));

// Lounge decor. Solid furniture collides like everything else; rugs, wall art, the clock and the bar stools are
// client-only. Kept clear of the seat points, the machines' open sides, the doors and the walking loop around the sofa
// group (see map.test.ts).
props.push(
  rect('bookshelf', 4.9, LZ + 0.1, 8.1, LZ + 0.5),    // north wall, right of the record board
  rect('bookshelf', 12.9, LZ + 0.1, 16.1, LZ + 0.5),  // north wall, east of the hall door
  rect('bookshelf', 2.0, D - 0.5, 5.2, D - 0.1),      // entrance-side wall
  rect('bookshelf', 13.3, D - 0.5, 15.3, D - 0.1),    // low shelf in the reading nook
  rect('coffeeTable', 5.75, LZ + 5.55, 7.25, LZ + 6.45), // between the two sofas
  rect('windowBar', 0.1, LZ + 2.0, 0.6, LZ + 10.0),   // narrow counter along the big window
  rect('armchair', 15.6, LZ + 10.4, 16.5, LZ + 11.3), // reading nook by the radio (decor, not a seat)
  box('bigPlant', CX1 - 0.7, LZ + 3.2, 0.8, 0.8),     // beside the corridor door
  box('plant', CX1 - 0.7, LZ + 0.9, 0.6, 0.6),
  box('plant', 0.7, D - 0.7, 0.6, 0.6),
);

// Cafe lounge (east): two coffee tables, each ringed by three armchairs (decor, not seats), a shelf and plants.
for (const [cx, side] of [[E + 6.5, -1], [E + 14.5, 1]] as const) {
  const cz = LZ + 6.5;
  props.push(
    rect('coffeeTable', cx - 0.75, cz - 0.45, cx + 0.75, cz + 0.45),
    rect('armchair', cx - 2.7, cz - 0.45, cx - 1.8, cz + 0.45),   // west of the table, turned toward it
    rect('armchair', cx + 1.8, cz - 0.45, cx + 2.7, cz + 0.45),   // east
    rect('armchair', cx - 0.45, side < 0 ? cz - 1.9 : cz + 1.0, cx + 0.45, side < 0 ? cz - 1.0 : cz + 1.9), // north / south
  );
}
props.push(
  rect('bookshelf', E + 4.0, D - 0.5, E + 7.2, D - 0.1), // entrance-side wall
  box('bigPlant', W - 0.7, LZ + 0.8, 0.8, 0.8),
  box('plant', W - 0.7, D - 0.7, 0.6, 0.6),
  box('plant', E + 2.6, D - 0.7, 0.6, 0.6),
);

export const MAP: {
  width: number; depth: number; wallHeight: 3; zones: Record<ZoneId, Rect>;
  walls: Wall[]; props: Prop[]; seats: Seat[]; interactables: Interactable[];
  windows: Rect[]; spawn: { x: number; z: number; facing: number };
} = {
  width: W, depth: D, wallHeight: 3,
  zones, walls, props, seats, interactables,
  windows: [
    { x1: 0, z1: LZ + 1, x2: 0.2, z2: LZ + 11 },      // big lounge window in the west wall x=0 (stays first)
    { x1: W - 0.2, z1: LZ + 1, x2: W, z2: LZ + 11 },  // cafe, east wall
    { x1: 0, z1: 14.7, x2: 0.2, z2: 20.3 },           // study room A, west wall
    { x1: W - 0.2, z1: 14.7, x2: W, z2: 20.3 },       // study room D, east wall
  ], // visual only: the walls stay solid colliders
  spawn: { x: CMX, z: D - 1, facing: Math.PI },
};

const ZONE_ORDER = Object.keys(zones) as ZoneId[];

/** Half-open zone lookup ([x1,x2) x [z1,z2)); null outside the building. */
export function zoneAt(x: number, z: number): ZoneId | null {
  for (const id of ZONE_ORDER) {
    const r = zones[id];
    if (x >= r.x1 && x < r.x2 && z >= r.z1 && z < r.z2) return id;
  }
  return null;
}

function hitsRect(r: Rect, x: number, z: number, radius: number): boolean {
  const nx = Math.min(Math.max(x, r.x1), r.x2);
  const nz = Math.min(Math.max(z, r.z1), r.z2);
  const dx = x - nx, dz = z - nz;
  if (radius <= 0) return x > r.x1 && x < r.x2 && z > r.z1 && z < r.z2;
  return dx * dx + dz * dz < radius * radius;
}

/** Circle (radius) vs walls + props. Chairs are not colliders. */
export function isBlocked(x: number, z: number, radius = 0): boolean {
  for (const w of walls) if (hitsRect(w, x, z, radius)) return true;
  for (const p of props) if (hitsRect(p, x, z, radius)) return true;
  return false;
}

const seatIndex = new Map(seats.map(s => [s.id, s]));
export function seatById(id: string): Seat | undefined {
  return seatIndex.get(id);
}

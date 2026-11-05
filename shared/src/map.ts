// Building map data + spatial queries. Shared by server (zones, movement, seats) and client (render, collision).
// Units: metres. x runs left->right, z runs back->entrance (entrance at z=24).
// Facing convention: forward = (sin(facing), cos(facing)) in (x, z); facing 0 looks +z, PI looks -z.

export type ZoneId = 'lounge' | 'corridor' | 'reading' | 'studyA' | 'studyB';
export interface Rect { x1: number; z1: number; x2: number; z2: number }
export type SeatKind = 'desk' | 'studyChair' | 'sofa';
export interface Seat { id: string; zone: ZoneId; kind: SeatKind; x: number; z: number; facing: number }
export type InteractableId = 'coffee' | 'vending' | 'radio' | 'board';
export interface Interactable { id: InteractableId; x: number; z: number }
export interface Wall extends Rect { glass: boolean }
export interface Prop extends Rect {
  kind: 'desk' | 'table' | 'counter' | 'vending' | 'sofa' | 'beanbag' | 'board' | 'plant'
    | 'bookshelf' | 'coffeeTable' | 'windowBar' | 'bigPlant' | 'armchair';
}

const T = 0.1; // half wall thickness (thickness 0.2)

const vWall = (x: number, z1: number, z2: number, glass = false): Wall =>
  ({ x1: x - T, z1, x2: x + T, z2, glass });
const hWall = (z: number, x1: number, x2: number, glass = false): Wall =>
  ({ x1, z1: z - T, x2, z2: z + T, glass });
const box = (kind: Prop['kind'], cx: number, cz: number, w: number, d: number): Prop =>
  ({ kind, x1: cx - w / 2, z1: cz - d / 2, x2: cx + w / 2, z2: cz + d / 2 });
const rect = (kind: Prop['kind'], x1: number, z1: number, x2: number, z2: number): Prop =>
  ({ kind, x1, z1, x2, z2 });

const zones: Record<ZoneId, Rect> = {
  lounge: { x1: 0, z1: 0, x2: 13, z2: 24 },
  corridor: { x1: 13, z1: 0, x2: 16, z2: 24 },
  reading: { x1: 16, z1: 0, x2: 36, z2: 14 },
  studyA: { x1: 16, z1: 14, x2: 36, z2: 19 },
  studyB: { x1: 16, z1: 19, x2: 36, z2: 24 },
};

const walls: Wall[] = [
  // outer
  vWall(0, 0, 24), vWall(36, 0, 24),
  hWall(0, -T, 36 + T),
  hWall(24, -T, 13), hWall(24, 16, 36 + T), // entrance gap x13-16
  // lounge | corridor (x=13), door z10-14
  vWall(13, 0, 10), vWall(13, 14, 24),
  // corridor | right rooms (x=16), doors z10-12 (reading), z15.5-17.5 (studyA), z20.5-22.5 (studyB); study rooms are glass
  vWall(16, 0, 10), vWall(16, 12, 14),
  vWall(16, 14, 15.5, true), vWall(16, 17.5, 19, true),
  vWall(16, 19, 20.5, true), vWall(16, 22.5, 24, true),
  // reading | studyA, studyA | studyB
  hWall(14, 16, 36), hWall(19, 16, 36),
];

const DESK_W = 1.6, DESK_D = 0.8;
const props: Prop[] = [];
const seats: Seat[] = [];
const interactables: Interactable[] = [
  { id: 'coffee', x: 1.0, z: 3.0 },
  { id: 'vending', x: 1.0, z: 6.0 },
  { id: 'radio', x: 6.5, z: 22.5 },
  { id: 'board', x: 6.5, z: 0.4 },
];

// Reading room: 6 columns x 4 rows of desks on a 3 m pitch (1.4 m between desks, ~1.4 m lane behind the chairs,
// ~2 m aisle along the corridor wall); chair is 0.85 behind (+z) the desk centre, facing the desk (-z).
for (let j = 0; j < 4; j++) {
  for (let i = 0; i < 6; i++) {
    const cx = 18.8 + 3.0 * i, cz = 2.0 + 3.0 * j;
    props.push(box('desk', cx, cz, DESK_W, DESK_D));
    seats.push({ id: `R${String(j * 6 + i + 1).padStart(2, '0')}`, zone: 'reading', kind: 'desk', x: cx, z: cz + 0.85, facing: Math.PI });
  }
}

// Study rooms: one 3x1.2 table each, 3 chairs per long side facing the table.
for (const [prefix, zone, cz] of [['A', 'studyA', 16.5], ['B', 'studyB', 21.5]] as const) {
  props.push(box('table', 26, cz, 3, 1.2));
  [24.5, 26, 27.5].forEach((x, k) => {
    seats.push({ id: `${prefix}${k + 1}`, zone, kind: 'studyChair', x, z: cz - 1.05, facing: 0 });
    seats.push({ id: `${prefix}${k + 4}`, zone, kind: 'studyChair', x, z: cz + 1.05, facing: Math.PI });
  });
}

// Lounge: two 3-seat sofas facing each other across a walkway, two beanbags. Seats sit just in front of each piece.
props.push(rect('sofa', 4, 9, 7, 10));    // S1-S3, seats face +z
props.push(rect('sofa', 4, 14, 7, 15));   // S4-S6, seats face -z
props.push(rect('beanbag', 9.1, 9.6, 9.9, 10.4));   // S7, seat faces +z
props.push(rect('beanbag', 9.1, 13.6, 9.9, 14.4));  // S8, seat faces -z
[4.5, 5.5, 6.5].forEach((x, k) => {
  seats.push({ id: `S${k + 1}`, zone: 'lounge', kind: 'sofa', x, z: 10.5, facing: 0 });
  seats.push({ id: `S${k + 4}`, zone: 'lounge', kind: 'sofa', x, z: 13.5, facing: Math.PI });
});
seats.push({ id: 'S7', zone: 'lounge', kind: 'sofa', x: 9.5, z: 11.0, facing: 0 });
seats.push({ id: 'S8', zone: 'lounge', kind: 'sofa', x: 9.5, z: 13.0, facing: Math.PI });

// Lounge fixtures (rects contain their interactable point; interaction happens from the open side).
props.push(rect('counter', 0.1, 2.0, 1.4, 4.0));    // coffee machine counter
props.push(rect('vending', 0.1, 5.4, 1.3, 6.6));    // vending machine
props.push(rect('board', 5.6, 0.1, 7.4, 0.5));      // record board on the back wall
props.push(box('plant', 12.2, 1.0, 0.6, 0.6), box('plant', 12.2, 23.0, 0.6, 0.6), box('plant', 0.7, 22.8, 0.6, 0.6));

// Lounge decor (v1.1). Solid furniture collides like everything else; rugs, wall art, the clock and the bar stools
// are client-only. Kept clear of the seat points, the machines' open sides, the lounge door and the walking loop
// around the sofa group (see map.test.ts).
props.push(
  rect('bookshelf', 2.0, 0.1, 5.2, 0.5),      // back wall, left of the record board
  rect('bookshelf', 7.8, 0.1, 11.0, 0.5),     // back wall, right of the record board
  rect('bookshelf', 12.5, 3.0, 12.9, 8.0),    // x=13 wall, north of the door
  rect('bookshelf', 12.5, 16.2, 12.9, 21.4),  // x=13 wall, south of the door
  rect('bookshelf', 1.6, 23.5, 3.6, 23.9),    // low shelf in the reading nook
  rect('coffeeTable', 4.75, 11.55, 6.25, 12.45), // between the two sofas
  rect('windowBar', 0.1, 8.0, 0.6, 19.0),     // narrow counter along the big window
  box('bigPlant', 0.75, 0.75, 0.8, 0.8),      // back corner
  box('bigPlant', 12.3, 15.2, 0.8, 0.8),      // beside the lounge door
  rect('armchair', 4.3, 22.4, 5.2, 23.3),     // reading nook by the radio (decor, not a seat)
);

export const MAP: {
  width: 36; depth: 24; wallHeight: 3; zones: Record<ZoneId, Rect>;
  walls: Wall[]; props: Prop[]; seats: Seat[]; interactables: Interactable[];
  windows: Rect[]; spawn: { x: number; z: number; facing: number };
} = {
  width: 36, depth: 24, wallHeight: 3,
  zones, walls, props, seats, interactables,
  windows: [{ x1: 0, z1: 4, x2: 0.2, z2: 20 }], // big lounge window in the back wall x=0
  spawn: { x: 14.5, z: 23, facing: Math.PI },
};

const ZONE_ORDER: ZoneId[] = ['lounge', 'corridor', 'reading', 'studyA', 'studyB'];

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

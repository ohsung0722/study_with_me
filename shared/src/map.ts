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
export interface Prop extends Rect { kind: 'desk' | 'table' | 'counter' | 'vending' | 'sofa' | 'beanbag' | 'board' | 'plant' }

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
  reading: { x1: 16, z1: 0, x2: 32, z2: 12 },
  studyA: { x1: 16, z1: 12, x2: 32, z2: 18 },
  studyB: { x1: 16, z1: 18, x2: 32, z2: 24 },
};

const walls: Wall[] = [
  // outer
  vWall(0, 0, 24), vWall(32, 0, 24),
  hWall(0, -T, 32 + T),
  hWall(24, -T, 13), hWall(24, 16, 32 + T), // entrance gap x13-16
  // lounge | corridor (x=13), door z10-14
  vWall(13, 0, 10), vWall(13, 14, 24),
  // corridor | right rooms (x=16), doors z9-11 (reading), z14-16 (studyA), z20-22 (studyB); study rooms are glass
  vWall(16, 0, 9), vWall(16, 11, 12),
  vWall(16, 12, 14, true), vWall(16, 16, 18, true),
  vWall(16, 18, 20, true), vWall(16, 22, 24, true),
  // reading | studyA, studyA | studyB
  hWall(12, 16, 32), hWall(18, 16, 32),
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

// Reading room: 6 columns x 4 rows of desks; chair is 0.85 behind (+z) the desk centre, facing the desk (-z).
for (let j = 0; j < 4; j++) {
  for (let i = 0; i < 6; i++) {
    const cx = 18.6 + 2.4 * i, cz = 1.8 + 2.6 * j;
    props.push(box('desk', cx, cz, DESK_W, DESK_D));
    seats.push({ id: `R${String(j * 6 + i + 1).padStart(2, '0')}`, zone: 'reading', kind: 'desk', x: cx, z: cz + 0.85, facing: Math.PI });
  }
}

// Study rooms: one 3x1.2 table each, 3 chairs per long side facing the table.
for (const [prefix, zone, cz] of [['A', 'studyA', 15], ['B', 'studyB', 21]] as const) {
  props.push(box('table', 24, cz, 3, 1.2));
  [22.5, 24, 25.5].forEach((x, k) => {
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

export const MAP: {
  width: 32; depth: 24; wallHeight: 3; zones: Record<ZoneId, Rect>;
  walls: Wall[]; props: Prop[]; seats: Seat[]; interactables: Interactable[];
  windows: Rect[]; spawn: { x: number; z: number; facing: number };
} = {
  width: 32, depth: 24, wallHeight: 3,
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

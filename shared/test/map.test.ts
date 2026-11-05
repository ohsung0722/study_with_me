import { describe, expect, test } from 'vitest';
import { INTERACT_RANGE, PLAYER_RADIUS } from '../src/constants';
import { MAP, ZONE_KIND, isBlocked, seatById, zoneAt, zoneKind, type SeatKind, type ZoneId } from '../src/map';

const STEP = 0.25;
const COLS = Math.round(MAP.width / STEP);
const ROWS = Math.round(MAP.depth / STEP);

// BFS over a 0.25m grid (8-connected, metric costs); a cell is walkable if a player circle fits there.
function gridDistancesFrom(start: { x: number; z: number }): Float64Array {
  const dist = new Float64Array(COLS * ROWS).fill(Infinity);
  const walkable = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < COLS && r < ROWS &&
    !isBlocked((c + 0.5) * STEP, (r + 0.5) * STEP, PLAYER_RADIUS);
  const sc = Math.floor(start.x / STEP), sr = Math.floor(start.z / STEP);
  dist[sr * COLS + sc] = 0;
  const queue: number[] = [sr * COLS + sc];
  // Dijkstra-lite: costs are only STEP or STEP*sqrt2, so use a simple label-correcting queue.
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi], c = cur % COLS, r = Math.floor(cur / COLS);
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      if (!dc && !dr) continue;
      const nc = c + dc, nr = r + dr;
      if (!walkable(nc, nr)) continue;
      if (dc && dr && (!walkable(c + dc, r) || !walkable(c, r + dr))) continue; // no corner cutting
      const nd = dist[cur] + (dc && dr ? STEP * Math.SQRT2 : STEP);
      if (nd < dist[nr * COLS + nc]) { dist[nr * COLS + nc] = nd; queue.push(nr * COLS + nc); }
    }
  }
  return dist;
}

// Shortest walk distance to any reachable cell within INTERACT_RANGE of the point.
function reachDistance(dist: Float64Array, p: { x: number; z: number }): number {
  let best = Infinity;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const d = dist[r * COLS + c];
    if (d === Infinity) continue;
    if (Math.hypot((c + 0.5) * STEP - p.x, (r + 0.5) * STEP - p.z) <= INTERACT_RANGE) best = Math.min(best, d);
  }
  return best;
}

/** Every point on the segment a→b (sampled every 0.1 m) has room for a player circle. */
function segmentClear(a: { x: number; z: number }, b: { x: number; z: number }, radius = PLAYER_RADIUS): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (isBlocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius)) return false;
  }
  return true;
}

const desks = () => MAP.props.filter(p => p.kind === 'desk');
const deskSeats = () => MAP.seats.filter(s => s.kind === 'desk');
// The east wing and the lounges are laid out relative to the corridor's east wall (E) and the halls' south wall (LZ).
const E = MAP.zones.corridor.x2, LZ = MAP.zones.lounge.z1, CMX = (MAP.zones.corridor.x1 + E) / 2;
const READING = [['reading', 17.2, -1, 1], ['readingB', E + 2.8, 1, 25]] as const; // zone, first column x, column step sign, first id
const STUDY = ['studyA', 'studyB', 'studyC', 'studyD'] as const;
const inZone = (zone: ZoneId) => (p: { x1: number; z1: number; x2: number; z2: number }) =>
  zoneAt((p.x1 + p.x2) / 2, (p.z1 + p.z2) / 2) === zone;
// Furniture that is gameplay or room structure (anything else is decor and must stay out of the way).
const V1_KINDS = new Set(['desk', 'table', 'counter', 'vending', 'sofa', 'beanbag', 'board', 'plant']);
// Doors: a wall along z at x (v) or along x at z (h), and the opening's extent.
type Door = { id: string; v: true; x: number; a1: number; a2: number } | { id: string; v: false; z: number; a1: number; a2: number };
const DOORS: Door[] = [
  { id: 'reading', v: true, x: 20, a1: 10, a2: 12 }, { id: 'readingB', v: true, x: E, a1: 10, a2: 12 },
  { id: 'lounge (corridor)', v: true, x: 20, a1: LZ + 4, a2: LZ + 8 }, { id: 'cafe (corridor)', v: true, x: E, a1: LZ + 4, a2: LZ + 8 },
  { id: 'lounge (hall)', v: false, z: LZ, a1: 9, a2: 12 }, { id: 'cafe (hall)', v: false, z: LZ, a1: E + 8, a2: E + 11 },
  { id: 'studyA', v: false, z: 21, a1: 7, a2: 9 }, { id: 'studyB', v: false, z: 21, a1: 17, a2: 19 },
  { id: 'studyC', v: false, z: 21, a1: E + 1, a2: E + 3 }, { id: 'studyD', v: false, z: 21, a1: E + 11, a2: E + 13 },
];
const door = (id: string) => DOORS.find(d => d.id === id)!;
/** Points across a door opening (inset by the player radius), and the point `off` metres from the wall on each side. */
const across = (d: Door, a: number, off: number) =>
  d.v ? [{ x: d.x - off, z: a }, { x: d.x + off, z: a }] : [{ x: a, z: d.z - off }, { x: a, z: d.z + off }];
// Where you stand to use each machine: its open side.
const OPEN_SIDE: Record<string, { x: number; z: number }> = {
  coffee: { x: E + 2.0, z: LZ + 1.9 }, vending: { x: E + 2.0, z: LZ + 10.0 }, board: { x: 3.5, z: LZ + 1.4 }, radio: { x: 17.5, z: LZ + 9.6 },
};

describe('map', () => {
  test('building is 45 m × 37 m: a 5 m main corridor with a mirrored wing on each side, 4 m halls', () => {
    expect(MAP.width).toBe(45);
    expect(MAP.depth).toBe(37);
    expect(MAP.zones).toEqual({
      reading: { x1: 0, z1: 0, x2: 20, z2: 14 },
      readingB: { x1: 25, z1: 0, x2: 45, z2: 14 },
      studyA: { x1: 0, z1: 14, x2: 10, z2: 21 },
      studyB: { x1: 10, z1: 14, x2: 20, z2: 21 },
      studyC: { x1: 25, z1: 14, x2: 35, z2: 21 },
      studyD: { x1: 35, z1: 14, x2: 45, z2: 21 },
      hallW: { x1: 0, z1: 21, x2: 20, z2: 25 },
      hallE: { x1: 25, z1: 21, x2: 45, z2: 25 },
      lounge: { x1: 0, z1: 25, x2: 20, z2: 37 },
      cafe: { x1: 25, z1: 25, x2: 45, z2: 37 },
      corridor: { x1: 20, z1: 0, x2: 25, z2: 37 },
    });
    expect(zoneKind('cafe')).toBe('lounge'); expect(zoneKind('hallE')).toBe('corridor'); expect(zoneKind(null)).toBeNull();
    // the zones tile the footprint exactly
    const area = Object.values(MAP.zones).reduce((a, r) => a + (r.x2 - r.x1) * (r.z2 - r.z1), 0);
    expect(area).toBe(45 * 37);
  });
  test('seat counts', () => {
    const by = (k: SeatKind) => MAP.seats.filter(s => s.kind === k).length;
    expect(by('desk')).toBe(48); expect(by('studyChair')).toBe(24); expect(by('sofa')).toBe(8);
    expect(new Set(MAP.seats.map(s => s.id)).size).toBe(MAP.seats.length);
  });
  test('every seat lies in its zone and is standable at PLAYER_RADIUS', () => {
    for (const s of MAP.seats) {
      expect(zoneAt(s.x, s.z)).toBe(s.zone);
      expect(isBlocked(s.x, s.z, PLAYER_RADIUS), s.id).toBe(false);
    }
  });
  test('reading desks: a 6 × 4 grid per room in id order (columns outward from the corridor), 3 m pitch, chair 0.85 m behind', () => {
    const seats = deskSeats();
    expect(seats.map(s => s.id)).toEqual(Array.from({ length: 48 }, (_, k) => `R${String(k + 1).padStart(2, '0')}`));
    for (const [zone, x0, dir, first] of READING) {
      seats.filter(s => s.zone === zone).forEach((s, k) => {
        expect(s.id).toBe(`R${String(first + k).padStart(2, '0')}`);
        const i = k % 6, j = Math.floor(k / 6);
        expect(s.x).toBeCloseTo(x0 + dir * 3.0 * i, 9);
        expect(s.z).toBeCloseTo(2.0 + 3.0 * j + 0.85, 9);
        expect(s.facing).toBeCloseTo(Math.PI, 9);
      });
    }
    for (const d of desks()) { expect(d.x2 - d.x1).toBeCloseTo(1.6, 9); expect(d.z2 - d.z1).toBeCloseTo(0.8, 9); }
  });
  test('reading desks are ≥ 1.4 m apart and the aisles between desk columns are walkable end to end', () => {
    for (const [zone] of READING) {
      const r = MAP.zones[zone], ds = desks().filter(inZone(zone));
      for (const a of ds) for (const b of ds) {
        if (a === b) continue;
        const gapX = Math.max(a.x1 - b.x2, b.x1 - a.x2), gapZ = Math.max(a.z1 - b.z2, b.z1 - a.z2);
        expect(Math.max(gapX, gapZ)).toBeGreaterThanOrEqual(1.4 - 1e-9);
      }
      const cols = [...new Set(ds.map(d => d.x2))].sort((m, n) => m - n).slice(0, -1);
      for (const x2 of cols) {
        const x = x2 + 0.7; // middle of the 1.4 m aisle
        expect(segmentClear({ x, z: 0.5 }, { x, z: 13.5 }), `${zone} aisle x=${x}`).toBe(true);
      }
      // ~2 m aisle along the corridor wall
      const toCorridor = zone === 'reading' ? (r.x2 - 0.1) - Math.max(...ds.map(d => d.x2)) : Math.min(...ds.map(d => d.x1)) - (r.x1 + 0.1);
      expect(toCorridor, zone).toBeGreaterThanOrEqual(1.8);
      const ax = zone === 'reading' ? r.x2 - 1 : r.x1 + 1;
      expect(segmentClear({ x: ax, z: 0.5 }, { x: ax, z: 13.5 }), `${zone} corridor aisle`).toBe(true);
    }
  });
  test('a walking lane runs behind every row of chairs (seated player to the next desk/wall ≥ 1.2 m)', () => {
    for (const [zone] of READING) {
      const r = MAP.zones[zone];
      const rows = [...new Set(deskSeats().filter(s => s.zone === zone).map(s => s.z))].sort((m, n) => m - n);
      const deskFronts = [...new Set(desks().filter(inZone(zone)).map(d => d.z1))].sort((m, n) => m - n);
      rows.forEach((z, j) => {
        const ahead = j + 1 < deskFronts.length ? deskFronts[j + 1] : r.z2 - 0.1;
        expect(ahead - (z + PLAYER_RADIUS), `${zone} row ${j}`).toBeGreaterThanOrEqual(1.2);
        const mid = (z + PLAYER_RADIUS + ahead) / 2;
        expect(segmentClear({ x: r.x1 + 0.6, z: mid }, { x: r.x2 - 0.6, z: mid }), `${zone} lane row ${j}`).toBe(true);
      });
    }
  });
  test('study rooms: one 3 × 1.2 table in the middle of each, 3 chairs per side 1.05 m from its centre', () => {
    for (const zone of STUDY) {
      const r = MAP.zones[zone], cx = (r.x1 + r.x2) / 2, cz = (r.z1 + r.z2) / 2;
      expect(r.z2 - r.z1, zone).toBeGreaterThanOrEqual(7); // deep enough for the follow camera (see cameraStudyRoom.test)
      const tables = MAP.props.filter(p => p.kind === 'table' && inZone(zone)(p));
      expect(tables.map(t => ({ cx: (t.x1 + t.x2) / 2, cz: (t.z1 + t.z2) / 2, w: t.x2 - t.x1, d: t.z2 - t.z1 })))
        .toEqual([{ cx: expect.closeTo(cx, 9), cz: expect.closeTo(cz, 9), w: expect.closeTo(3, 9), d: expect.closeTo(1.2, 9) }]);
      const p = zone.slice(-1);
      [cx - 1.5, cx, cx + 1.5].forEach((x, k) => {
        expect(seatById(`${p}${k + 1}`)).toMatchObject({ zone, x, z: cz - 1.05, facing: 0 });
        expect(seatById(`${p}${k + 4}`)).toMatchObject({ zone, x, z: cz + 1.05, facing: Math.PI });
      });
    }
  });
  test('zoneAt samples', () => {
    expect(zoneAt(5, 30)).toBe('lounge'); expect(zoneAt(30, 30)).toBe('cafe');
    expect(zoneAt(22.5, 12)).toBe('corridor'); expect(zoneAt(24.9, 23)).toBe('corridor');
    expect(zoneAt(5, 22)).toBe('hallW'); expect(zoneAt(40, 24.9)).toBe('hallE');
    expect(zoneAt(5, 5)).toBe('reading'); expect(zoneAt(19.9, 13.9)).toBe('reading'); expect(zoneAt(30, 5)).toBe('readingB');
    expect(zoneAt(5, 15)).toBe('studyA'); expect(zoneAt(15, 20.9)).toBe('studyB');
    expect(zoneAt(27, 15)).toBe('studyC'); expect(zoneAt(44.9, 20.9)).toBe('studyD');
    expect(zoneAt(-1, 5)).toBeNull(); expect(zoneAt(45, 5)).toBeNull(); expect(zoneAt(5, 37)).toBeNull();
  });
  test('walls block, doors do not', () => {
    expect(isBlocked(0, 5)).toBe(true);        // outer walls
    expect(isBlocked(45, 5)).toBe(true);
    expect(isBlocked(44, 0)).toBe(true);
    expect(isBlocked(44, 37)).toBe(true);
    for (const x of [20.5, CMX, 24.5]) expect(isBlocked(x, 37), `entrance x=${x}`).toBe(false); // the corridor's full width
    expect(isBlocked(19, 37)).toBe(true);
    expect(isBlocked(5, 14)).toBe(true);       // reading | study rooms
    expect(isBlocked(30, 14)).toBe(true);
    expect(isBlocked(10, 17)).toBe(true);      // study A | B
    expect(isBlocked(E + 10, 17)).toBe(true);  // study C | D
    expect(isBlocked(20, 9)).toBe(true);       // reading walls on the corridor, opaque
    expect(isBlocked(E, 13)).toBe(true);
    // the study rooms' corridor walls are glass without a door; reading rooms and lounges stay opaque
    for (const x of [20, E]) for (const z of [14.5, 17.5, 20.5]) expect(isBlocked(x, z), `x=${x} z=${z}`).toBe(true);
    const glass = MAP.walls.filter(w => w.glass);
    for (const x of [20, E]) expect(glass.some(w => w.x1 < x && w.x2 > x && w.z1 <= 14 && w.z2 >= 21), `x=${x}`).toBe(true);
    expect(glass.every(w => zoneKind(zoneAt(Math.max(0.01, w.x1 - 0.2), (w.z1 + w.z2) / 2)) !== 'reading')).toBe(true);
    // both walls of each hall (study rooms | hall at z=21, hall | lounge at z=LZ) are glass all along
    for (const z of [21, LZ]) {
      const along = MAP.walls.filter(w => w.z1 < z && w.z2 > z && w.x2 - w.x1 > w.z2 - w.z1);
      expect(along.length, `z=${z}`).toBeGreaterThan(0);
      expect(along.every(w => w.glass), `z=${z}`).toBe(true);
    }
    // the halls open onto the main corridor over their whole width
    for (let z = 21.1 + PLAYER_RADIUS + 0.05; z <= LZ - 0.1 - PLAYER_RADIUS - 0.05 + 1e-9; z += 0.1) { // between the wall faces
      expect(segmentClear({ x: 18.5, z }, { x: E + 1.5, z }), `hall junction z=${z.toFixed(2)}`).toBe(true);
    }
    // every door opening fits a player crossing it, ±0.6 m on both sides
    for (const d of DOORS) {
      for (let a = d.a1 + PLAYER_RADIUS + 0.05; a <= d.a2 - PLAYER_RADIUS - 0.05 + 1e-9; a += 0.1) {
        const [p, q] = across(d, a, 0.6);
        expect(segmentClear(p, q), `${d.id} door at ${a.toFixed(2)}`).toBe(true);
      }
      const [w1, w2] = d.v ? [[d.x, d.a1 - 0.05], [d.x, d.a2 + 0.05]] : [[d.a1 - 0.05, d.z], [d.a2 + 0.05, d.z]];
      expect(isBlocked(w1[0], w1[1]), `${d.id} wall before`).toBe(true); // the wall resumes right outside the opening
      expect(isBlocked(w2[0], w2[1]), `${d.id} wall after`).toBe(true);
    }
  });
  test('seatById', () => {
    expect(seatById('R01')?.kind).toBe('desk');
    expect(seatById('R48')?.zone).toBe('readingB');
    expect(seatById('D6')?.zone).toBe('studyD');
    expect(seatById('nope')).toBeUndefined();
  });
  test('spawn is standable, in the corridor', () => {
    expect(isBlocked(MAP.spawn.x, MAP.spawn.z, PLAYER_RADIUS)).toBe(false);
    expect(zoneAt(MAP.spawn.x, MAP.spawn.z)).toBe('corridor');
  });
  test('every seat and interactable is reachable from spawn; farthest desk within a 12 s walk', () => {
    const dist = gridDistancesFrom(MAP.spawn);
    for (const p of [...MAP.seats, ...MAP.interactables]) expect(reachDistance(dist, p)).toBeLessThan(Infinity);
    const far = Math.max(...MAP.seats.filter(s => s.kind === 'desk').map(s => reachDistance(dist, s)));
    expect(far).toBeLessThanOrEqual(48); // 4 m/s × 12 s
  });
  test('decor stays in the lounges and study rooms; the lounge has its shelves, coffee table, window bar and nook', () => {
    for (const p of MAP.props.filter(pp => !V1_KINDS.has(pp.kind))) {
      const kind = zoneKind(zoneAt((p.x1 + p.x2) / 2, (p.z1 + p.z2) / 2));
      expect(kind === 'lounge' || kind === 'study', p.kind).toBe(true);
    }
    const lounge = MAP.props.filter(inZone('lounge')), kinds = lounge.map(p => p.kind);
    for (const k of ['bookshelf', 'coffeeTable', 'windowBar', 'bigPlant', 'armchair', 'board'] as const) expect(kinds).toContain(k);
    // coffee table between the two sofas; window bar along the big window (x≈0)
    const ct = lounge.find(p => p.kind === 'coffeeTable')!;
    const sofas = MAP.props.filter(p => p.kind === 'sofa');
    expect(ct.z1).toBeGreaterThan(Math.min(...sofas.map(s => s.z2)));
    expect(ct.z2).toBeLessThan(Math.max(...sofas.map(s => s.z1)));
    const bar = MAP.props.find(p => p.kind === 'windowBar')!;
    expect(bar.x1).toBeLessThan(0.2);
    expect(bar.z1).toBeGreaterThanOrEqual(MAP.windows[0].z1); expect(bar.z2).toBeLessThanOrEqual(MAP.windows[0].z2);
    // the machines are in the cafe
    for (const k of ['counter', 'vending'] as const) expect(zoneAt(...center(MAP.props.find(p => p.kind === k)!)), k).toBe('cafe');
  });
  test('lounge decor keeps seats, machines and the lounge doors clear', () => {
    const decor = MAP.props.filter(p => !V1_KINDS.has(p.kind));
    const near = (pt: { x: number; z: number }, gap: number) =>
      decor.filter(p => Math.hypot(pt.x - Math.min(Math.max(pt.x, p.x1), p.x2), pt.z - Math.min(Math.max(pt.z, p.z1), p.z2)) < gap);
    // a player can stand at and step off every lounge seat
    for (const s of MAP.seats.filter(st => ZONE_KIND[st.zone] === 'lounge')) expect(near(s, PLAYER_RADIUS + 0.4), s.id).toEqual([]);
    // every interactable has a standable spot on its open side within reach, with no decor in between
    for (const it of MAP.interactables) {
      const o = OPEN_SIDE[it.id];
      expect(Math.hypot(o.x - it.x, o.z - it.z)).toBeLessThanOrEqual(INTERACT_RANGE);
      expect(isBlocked(o.x, o.z, PLAYER_RADIUS), it.id).toBe(false);
      expect(near(o, PLAYER_RADIUS + 0.3), it.id).toEqual([]);
    }
    // the approach to every lounge door stays open (1.5 m into the room across the whole opening)
    for (const d of DOORS.filter(dd => dd.id.startsWith('lounge') || dd.id.startsWith('cafe'))) {
      for (let a = d.a1 + PLAYER_RADIUS + 0.05; a <= d.a2 - PLAYER_RADIUS - 0.05 + 1e-9; a += 0.25) {
        const [p, q] = across(d, a, 1.5);
        expect(segmentClear(p, q), `${d.id} at ${a}`).toBe(true);
      }
    }
  });
  test('study rooms are furnished: cabinet, coat rack, big plant and a low shelf, each wholly inside its room', () => {
    for (const room of STUDY) {
      const r = MAP.zones[room];
      const inRoom = MAP.props.filter(inZone(room));
      const kinds = inRoom.map(p => p.kind);
      for (const k of ['cabinet', 'coatRack', 'bigPlant', 'bookshelf', 'table', 'tvStand'] as const) expect(kinds, room).toContain(k);
      for (const p of inRoom) {
        // inside the room, not poking into a wall (inner wall faces are 0.1 m in from the zone edges)
        expect(p.x1, `${room} ${p.kind}`).toBeGreaterThanOrEqual(r.x1 + 0.1 - 1e-9);
        expect(p.x2, `${room} ${p.kind}`).toBeLessThanOrEqual(r.x2 - 0.1 + 1e-9);
        expect(p.z1, `${room} ${p.kind}`).toBeGreaterThanOrEqual(r.z1 + 0.1 - 1e-9);
        expect(p.z2, `${room} ${p.kind}`).toBeLessThanOrEqual(r.z2 - 0.1 + 1e-9);
      }
    }
  });
  test('study rooms open onto the hall: every chair is a short walk from the door, and the door approach stays open', () => {
    for (const room of STUDY) {
      const d = door(room) as Extract<Door, { v: false }>, xm = (d.a1 + d.a2) / 2;
      const dist = gridDistancesFrom({ x: xm, z: d.z - 0.6 }); // just inside the door
      for (const s of MAP.seats.filter(st => st.zone === room)) {
        // the chair's own spot (not just a spot within reach of it) can be walked to
        const cell = Math.floor(s.z / STEP) * COLS + Math.floor(s.x / STEP);
        expect(dist[cell], s.id).toBeLessThan(Infinity);
        expect(dist[cell], s.id).toBeLessThanOrEqual(10);
      }
      for (let x = d.a1 + PLAYER_RADIUS + 0.05; x <= d.a2 - PLAYER_RADIUS - 0.05 + 1e-9; x += 0.25) {
        expect(segmentClear({ x, z: d.z + 1.5 }, { x, z: d.z - 2.0 }), `${room} door x=${x}`).toBe(true);
      }
    }
  });
  test('windows sit on the outer walls (lounge, cafe, study rooms A and D); the walls stay solid', () => {
    expect(MAP.windows[0]).toEqual({ x1: 0, z1: LZ + 1, x2: 0.2, z2: LZ + 11 }); // the lounge window stays first
    const W = MAP.width;
    const onWall = (w: (typeof MAP.windows)[number]) => (w.x1 <= 0 + 1e-9 ? 'west' : w.x2 >= W - 1e-9 ? 'east' : 'inner');
    const where = MAP.windows.map(w => [onWall(w), zoneAt(w.x1 <= 0 ? 0.5 : W - 0.5, (w.z1 + w.z2) / 2)]);
    expect(where).toEqual([['west', 'lounge'], ['east', 'cafe'], ['west', 'studyA'], ['east', 'studyD']]);
    for (const w of MAP.windows) {
      expect(w.z2 - w.z1).toBeGreaterThanOrEqual(2.5);
      expect(isBlocked(w.x1 <= 0 ? 0 : W, (w.z1 + w.z2) / 2)).toBe(true);
    }
  });
  test('cafe: two coffee tables, each ringed by three armchairs you can walk around', () => {
    const tables = MAP.props.filter(p => p.kind === 'coffeeTable' && inZone('cafe')(p));
    expect(tables).toHaveLength(2);
    for (const t of tables) {
      const [tx, tz] = center(t);
      const chairs = MAP.props.filter(p => p.kind === 'armchair' && Math.hypot(center(p)[0] - tx, center(p)[1] - tz) < 2.5);
      expect(chairs).toHaveLength(3);
      const ring = [{ x: tx - 3.4, z: tz - 2.6 }, { x: tx + 3.4, z: tz - 2.6 }, { x: tx + 3.4, z: tz + 2.6 }, { x: tx - 3.4, z: tz + 2.6 }];
      ring.forEach((a, i) => expect(segmentClear(a, ring[(i + 1) % ring.length]), `table x=${tx} leg ${i}`).toBe(true));
    }
  });
  test('a clear walking loop runs around the sofa group in the lounge, joined to both lounge doors', () => {
    const loop = [{ x: 2.5, z: LZ + 1.6 }, { x: 12, z: LZ + 1.6 }, { x: 12, z: LZ + 10.6 }, { x: 2.5, z: LZ + 10.6 }];
    loop.forEach((a, i) => expect(segmentClear(a, loop[(i + 1) % loop.length]), `leg ${i}`).toBe(true));
    expect(segmentClear({ x: 12, z: LZ + 6 }, { x: 21, z: LZ + 6 })).toBe(true);    // corridor door
    expect(segmentClear({ x: 10.5, z: LZ + 1.6 }, { x: 10.5, z: LZ - 1.5 })).toBe(true); // hall door
  });
});

function center(p: { x1: number; z1: number; x2: number; z2: number }): [number, number] {
  return [(p.x1 + p.x2) / 2, (p.z1 + p.z2) / 2];
}

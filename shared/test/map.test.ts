import { describe, expect, test } from 'vitest';
import { INTERACT_RANGE, PLAYER_RADIUS } from '../src/constants';
import { MAP, isBlocked, seatById, zoneAt, type SeatKind } from '../src/map';

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
// Furniture that existed before v1.1 (anything else in the lounge is new decor and must stay out of the way).
const V1_KINDS = new Set(['desk', 'table', 'counter', 'vending', 'sofa', 'beanbag', 'board', 'plant']);
// Doors: [wall axis, wall coordinate, opening from, opening to]
const DOORS = {
  lounge: { x: 13, z1: 10, z2: 14 },
  reading: { x: 16, z1: 10, z2: 12 },
  studyA: { x: 16, z1: 15.5, z2: 17.5 },
  studyB: { x: 16, z1: 20.5, z2: 22.5 },
} as const;
// Where you stand to use each machine: its open side.
const OPEN_SIDE: Record<string, { x: number; z: number }> = {
  coffee: { x: 2.0, z: 3.0 }, vending: { x: 2.0, z: 6.0 }, board: { x: 6.5, z: 1.4 }, radio: { x: 6.5, z: 21.5 },
};

describe('map', () => {
  test('building is 36 m × 24 m with the v1.1 zone rects', () => {
    expect(MAP.width).toBe(36);
    expect(MAP.depth).toBe(24);
    expect(MAP.zones).toEqual({
      lounge: { x1: 0, z1: 0, x2: 13, z2: 24 },
      corridor: { x1: 13, z1: 0, x2: 16, z2: 24 },
      reading: { x1: 16, z1: 0, x2: 36, z2: 14 },
      studyA: { x1: 16, z1: 14, x2: 36, z2: 19 },
      studyB: { x1: 16, z1: 19, x2: 36, z2: 24 },
    });
  });
  test('seat counts', () => {
    const by = (k: SeatKind) => MAP.seats.filter(s => s.kind === k).length;
    expect(by('desk')).toBe(24); expect(by('studyChair')).toBe(12); expect(by('sofa')).toBe(8);
    expect(new Set(MAP.seats.map(s => s.id)).size).toBe(MAP.seats.length);
  });
  test('every seat lies in its zone and is standable at PLAYER_RADIUS', () => {
    for (const s of MAP.seats) {
      expect(zoneAt(s.x, s.z)).toBe(s.zone);
      expect(isBlocked(s.x, s.z, PLAYER_RADIUS), s.id).toBe(false);
    }
  });
  test('reading desks: 6 × 4 grid in id order, 3 m pitch, chair 0.85 m behind facing the desk', () => {
    const seats = deskSeats();
    expect(seats.map(s => s.id)).toEqual(Array.from({ length: 24 }, (_, k) => `R${String(k + 1).padStart(2, '0')}`));
    seats.forEach((s, k) => {
      const i = k % 6, j = Math.floor(k / 6);
      expect(s.x).toBeCloseTo(18.8 + 3.0 * i, 9);
      expect(s.z).toBeCloseTo(2.0 + 3.0 * j + 0.85, 9);
      expect(s.facing).toBeCloseTo(Math.PI, 9);
    });
    for (const d of desks()) { expect(d.x2 - d.x1).toBeCloseTo(1.6, 9); expect(d.z2 - d.z1).toBeCloseTo(0.8, 9); }
  });
  test('reading desks are ≥ 1.4 m apart and the aisles between desk columns are walkable end to end', () => {
    const ds = desks();
    for (const a of ds) for (const b of ds) {
      if (a === b) continue;
      const gapX = Math.max(a.x1 - b.x2, b.x1 - a.x2), gapZ = Math.max(a.z1 - b.z2, b.z1 - a.z2);
      expect(Math.max(gapX, gapZ)).toBeGreaterThanOrEqual(1.4 - 1e-9);
    }
    const cols = [...new Set(ds.map(d => d.x2))].sort((m, n) => m - n).slice(0, -1);
    for (const x2 of cols) {
      const x = x2 + 0.7; // middle of the 1.4 m aisle
      expect(segmentClear({ x, z: 0.5 }, { x, z: 13.5 }), `aisle x=${x}`).toBe(true);
    }
    // ~2 m aisle along the corridor wall
    const westEdge = Math.min(...ds.map(d => d.x1));
    expect(westEdge - (16 + 0.1)).toBeGreaterThanOrEqual(1.8);
    expect(segmentClear({ x: 17, z: 0.5 }, { x: 17, z: 13.5 })).toBe(true);
  });
  test('a walking lane runs behind every row of chairs (seated player to the next desk/wall ≥ 1.2 m)', () => {
    const rows = [...new Set(deskSeats().map(s => s.z))].sort((m, n) => m - n);
    const deskFronts = [...new Set(desks().map(d => d.z1))].sort((m, n) => m - n);
    rows.forEach((z, j) => {
      const ahead = j + 1 < deskFronts.length ? deskFronts[j + 1] : MAP.zones.reading.z2 - 0.1;
      expect(ahead - (z + PLAYER_RADIUS), `row ${j}`).toBeGreaterThanOrEqual(1.2);
      const mid = (z + PLAYER_RADIUS + ahead) / 2;
      expect(segmentClear({ x: 16.6, z: mid }, { x: 35.4, z: mid }), `lane row ${j}`).toBe(true);
    });
  });
  test('study rooms: one 3 × 1.2 table each, 3 chairs per side 1.05 m from its centre', () => {
    const tables = MAP.props.filter(p => p.kind === 'table');
    expect(tables.map(t => ({ cx: (t.x1 + t.x2) / 2, cz: (t.z1 + t.z2) / 2, w: t.x2 - t.x1, d: t.z2 - t.z1 })))
      .toEqual([16.5, 21.5].map(cz => ({ cx: expect.closeTo(26, 9), cz: expect.closeTo(cz, 9), w: expect.closeTo(3, 9), d: expect.closeTo(1.2, 9) })));
    for (const [p, cz] of [['A', 16.5], ['B', 21.5]] as const) {
      [24.5, 26, 27.5].forEach((x, k) => {
        expect(seatById(`${p}${k + 1}`)).toMatchObject({ x, z: cz - 1.05, facing: 0 });
        expect(seatById(`${p}${k + 4}`)).toMatchObject({ x, z: cz + 1.05, facing: Math.PI });
      });
    }
  });
  test('zoneAt samples', () => {
    expect(zoneAt(5, 5)).toBe('lounge'); expect(zoneAt(14.5, 12)).toBe('corridor');
    expect(zoneAt(20, 5)).toBe('reading'); expect(zoneAt(35, 13.9)).toBe('reading');
    expect(zoneAt(20, 15)).toBe('studyA'); expect(zoneAt(35, 18.9)).toBe('studyA');
    expect(zoneAt(20, 21)).toBe('studyB'); expect(zoneAt(-1, 5)).toBeNull(); expect(zoneAt(36, 5)).toBeNull();
  });
  test('walls block, doors do not', () => {
    expect(isBlocked(13, 5)).toBe(true);     // lounge wall
    expect(isBlocked(36, 5)).toBe(true);     // outer wall moved to x=36
    expect(isBlocked(34, 0)).toBe(true);     // back wall reaches x=36
    expect(isBlocked(34, 24)).toBe(true);    // entrance wall reaches x=36
    expect(isBlocked(14.5, 24)).toBe(false); // entrance
    expect(isBlocked(25, 14)).toBe(true);    // reading | studyA
    expect(isBlocked(25, 19)).toBe(true);    // studyA | studyB
    expect(isBlocked(16, 9)).toBe(true);     // reading wall, opaque
    expect(isBlocked(16, 13)).toBe(true);    // reading wall, opaque
    for (const z of [14.5, 18, 20, 23]) expect(isBlocked(16, z)).toBe(true); // study glass segments
    const glass = MAP.walls.filter(w => w.glass);
    for (const z of [14.75, 18.25, 19.75, 23.25]) expect(glass.some(w => w.x1 < 16 && w.x2 > 16 && w.z1 < z && w.z2 > z)).toBe(true);
    expect(MAP.walls.some(w => w.glass && w.x1 < 16 && w.x2 > 16 && w.z2 <= 14)).toBe(false); // reading stays opaque
    // every door opening fits a player crossing it, ±0.6 m on both sides
    for (const [id, d] of Object.entries(DOORS)) {
      for (let z = d.z1 + PLAYER_RADIUS + 0.05; z <= d.z2 - PLAYER_RADIUS - 0.05 + 1e-9; z += 0.1) {
        expect(segmentClear({ x: d.x - 0.6, z }, { x: d.x + 0.6, z }), `${id} door z=${z.toFixed(2)}`).toBe(true);
      }
      expect(isBlocked(d.x, d.z1 - 0.05)).toBe(true); // the wall resumes right outside the opening
      expect(isBlocked(d.x, d.z2 + 0.05)).toBe(true);
    }
  });
  test('seatById', () => {
    expect(seatById('R01')?.kind).toBe('desk');
    expect(seatById('B6')?.zone).toBe('studyB');
    expect(seatById('nope')).toBeUndefined();
  });
  test('spawn is standable, in the corridor', () => {
    expect(isBlocked(MAP.spawn.x, MAP.spawn.z, PLAYER_RADIUS)).toBe(false);
    expect(zoneAt(MAP.spawn.x, MAP.spawn.z)).toBe('corridor');
  });
  test('every seat and interactable is reachable from spawn; farthest desk within 10s walk', () => {
    const dist = gridDistancesFrom(MAP.spawn);
    for (const p of [...MAP.seats, ...MAP.interactables]) expect(reachDistance(dist, p)).toBeLessThan(Infinity);
    const far = Math.max(...MAP.seats.filter(s => s.kind === 'desk').map(s => reachDistance(dist, s)));
    expect(far).toBeLessThanOrEqual(40); // 4 m/s × 10 s
  });
  test('lounge is furnished: shelves, coffee table, window bar, big plants, reading-nook armchair', () => {
    const kinds = MAP.props.map(p => p.kind);
    for (const k of ['bookshelf', 'coffeeTable', 'windowBar', 'bigPlant', 'armchair'] as const) expect(kinds).toContain(k);
    expect(kinds.filter(k => k === 'bookshelf').length).toBeGreaterThanOrEqual(3);
    for (const p of MAP.props.filter(pp => !V1_KINDS.has(pp.kind))) {
      const zone = zoneAt((p.x1 + p.x2) / 2, (p.z1 + p.z2) / 2);
      if (zone === 'studyA' || zone === 'studyB') continue; // v1.2 study-room furniture (see below)
      expect(zone, p.kind).toBe('lounge');
    }
    // coffee table between the two sofas; window bar along the big window (x≈0, z≈8–19)
    const ct = MAP.props.find(p => p.kind === 'coffeeTable')!;
    const sofas = MAP.props.filter(p => p.kind === 'sofa');
    expect(ct.z1).toBeGreaterThan(Math.min(...sofas.map(s => s.z2)));
    expect(ct.z2).toBeLessThan(Math.max(...sofas.map(s => s.z1)));
    const bar = MAP.props.find(p => p.kind === 'windowBar')!;
    expect(bar.x1).toBeLessThan(0.2);
    expect(bar.z1).toBeLessThanOrEqual(9); expect(bar.z2).toBeGreaterThanOrEqual(18);
    expect(bar.z1).toBeGreaterThanOrEqual(MAP.windows[0].z1); expect(bar.z2).toBeLessThanOrEqual(MAP.windows[0].z2);
  });
  test('lounge decor keeps seats, machines and the lounge door clear', () => {
    const decor = MAP.props.filter(p => !V1_KINDS.has(p.kind));
    const near = (pt: { x: number; z: number }, gap: number) =>
      decor.filter(p => Math.hypot(pt.x - Math.min(Math.max(pt.x, p.x1), p.x2), pt.z - Math.min(Math.max(pt.z, p.z1), p.z2)) < gap);
    // a player can stand at and step off every lounge seat
    for (const s of MAP.seats.filter(st => st.zone === 'lounge')) expect(near(s, PLAYER_RADIUS + 0.4), s.id).toEqual([]);
    // every interactable has a standable spot on its open side within reach, with no decor in between
    for (const it of MAP.interactables) {
      const o = OPEN_SIDE[it.id];
      expect(Math.hypot(o.x - it.x, o.z - it.z)).toBeLessThanOrEqual(INTERACT_RANGE);
      expect(isBlocked(o.x, o.z, PLAYER_RADIUS), it.id).toBe(false);
      expect(near(o, PLAYER_RADIUS + 0.3), it.id).toEqual([]);
    }
    // the approach to the lounge door stays open (1.5 m into the lounge across the whole opening)
    const d = DOORS.lounge;
    for (let z = d.z1 + PLAYER_RADIUS + 0.05; z <= d.z2 - PLAYER_RADIUS - 0.05 + 1e-9; z += 0.25) {
      expect(segmentClear({ x: d.x - 1.5, z }, { x: d.x, z }), `lounge door z=${z}`).toBe(true);
    }
  });
  test('study rooms are furnished: cabinet, coat rack, big plant and a low shelf, each wholly inside its room', () => {
    for (const room of ['studyA', 'studyB'] as const) {
      const r = MAP.zones[room];
      const inRoom = MAP.props.filter(p => zoneAt((p.x1 + p.x2) / 2, (p.z1 + p.z2) / 2) === room);
      const kinds = inRoom.map(p => p.kind);
      for (const k of ['cabinet', 'coatRack', 'bigPlant', 'bookshelf', 'table'] as const) expect(kinds, room).toContain(k);
      for (const p of inRoom) {
        // inside the room, not poking into a wall (inner wall faces are 0.1 m in from the zone edges)
        expect(p.x1, `${room} ${p.kind}`).toBeGreaterThanOrEqual(r.x1 + 0.1 - 1e-9);
        expect(p.x2, `${room} ${p.kind}`).toBeLessThanOrEqual(r.x2 - 0.1 + 1e-9);
        expect(p.z1, `${room} ${p.kind}`).toBeGreaterThanOrEqual(r.z1 + 0.1 - 1e-9);
        expect(p.z2, `${room} ${p.kind}`).toBeLessThanOrEqual(r.z2 - 0.1 + 1e-9);
      }
    }
  });
  test('study rooms: every chair is reachable on foot from its door, and the door approach stays open', () => {
    for (const [room, d] of [['studyA', DOORS.studyA], ['studyB', DOORS.studyB]] as const) {
      const zm = (d.z1 + d.z2) / 2;
      const dist = gridDistancesFrom({ x: d.x + 0.6, z: zm }); // just inside the door
      for (const s of MAP.seats.filter(st => st.zone === room)) {
        // the chair's own spot (not just a spot within reach of it) can be walked to
        const cell = Math.floor(s.z / STEP) * COLS + Math.floor(s.x / STEP);
        expect(dist[cell], s.id).toBeLessThan(Infinity);
        expect(dist[cell], s.id).toBeLessThanOrEqual(16); // a short walk: ~8.5 m to the table plus going round it
      }
      for (let z = d.z1 + PLAYER_RADIUS + 0.05; z <= d.z2 - PLAYER_RADIUS - 0.05 + 1e-9; z += 0.25) {
        expect(segmentClear({ x: d.x, z }, { x: d.x + 2.0, z }), `${room} door z=${z}`).toBe(true);
      }
      // the lane from the door to the table end runs straight down the room's middle
      expect(segmentClear({ x: d.x + 0.6, z: zm }, { x: 24.0, z: zm }), `${room} lane`).toBe(true);
    }
  });
  test('study rooms get windows on the outer east wall x=36 (room B also on the south wall); the walls stay solid', () => {
    for (const room of ['studyA', 'studyB'] as const) {
      const r = MAP.zones[room];
      const east = MAP.windows.filter(w => w.x1 < 36 && w.x2 >= 36 - 1e-9 && w.z1 >= r.z1 && w.z2 <= r.z2);
      expect(east, room).toHaveLength(1);
      expect(east[0].z2 - east[0].z1, room).toBeGreaterThanOrEqual(2.5);
      for (const w of east) expect(isBlocked(36, (w.z1 + w.z2) / 2)).toBe(true);
    }
    const south = MAP.windows.filter(w => w.z1 < 24 && w.z2 >= 24 - 1e-9);
    expect(south).toHaveLength(1);
    expect(zoneAt((south[0].x1 + south[0].x2) / 2, 23.5)).toBe('studyB');
    expect(isBlocked((south[0].x1 + south[0].x2) / 2, 24)).toBe(true);
    expect(MAP.windows[0]).toEqual({ x1: 0, z1: 4, x2: 0.2, z2: 20 }); // the lounge window stays first
  });
  test('a clear walking loop runs around the sofa group in the lounge', () => {
    const loop = [{ x: 2.5, z: 7.6 }, { x: 11, z: 7.6 }, { x: 11, z: 17 }, { x: 2.5, z: 17 }];
    loop.forEach((a, i) => expect(segmentClear(a, loop[(i + 1) % loop.length]), `leg ${i}`).toBe(true));
    // and the loop connects to the lounge door
    expect(segmentClear({ x: 11, z: 12 }, { x: 13.5, z: 12 })).toBe(true);
  });
});

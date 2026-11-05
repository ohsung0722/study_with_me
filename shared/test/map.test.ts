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

describe('map', () => {
  test('seat counts', () => {
    const by = (k: SeatKind) => MAP.seats.filter(s => s.kind === k).length;
    expect(by('desk')).toBe(24); expect(by('studyChair')).toBe(12); expect(by('sofa')).toBe(8);
    expect(new Set(MAP.seats.map(s => s.id)).size).toBe(MAP.seats.length);
  });
  test('every seat lies in its zone and is standable', () => {
    for (const s of MAP.seats) { expect(zoneAt(s.x, s.z)).toBe(s.zone); expect(isBlocked(s.x, s.z, 0.3)).toBe(false); }
  });
  test('zoneAt samples', () => {
    expect(zoneAt(5, 5)).toBe('lounge'); expect(zoneAt(14.5, 12)).toBe('corridor');
    expect(zoneAt(20, 5)).toBe('reading'); expect(zoneAt(20, 15)).toBe('studyA');
    expect(zoneAt(20, 21)).toBe('studyB'); expect(zoneAt(-1, 5)).toBeNull();
  });
  test('walls block, doors do not', () => {
    expect(isBlocked(13, 5)).toBe(true);     // lounge wall
    expect(isBlocked(13, 12)).toBe(false);   // lounge door
    expect(isBlocked(16, 10)).toBe(false);   // reading door
    expect(isBlocked(16, 15)).toBe(false);   // studyA door
    expect(isBlocked(16, 21)).toBe(false);   // studyB door
    expect(isBlocked(14.5, 24)).toBe(false); // entrance
    expect(isBlocked(16, 17)).toBe(true);    // studyA|studyB glass wall segment
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
});

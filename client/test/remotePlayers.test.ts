// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import type { PlayerView } from '@studyverse/shared';
import { RemotePlayers } from '../src/game/players';

beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterAll(() => { vi.restoreAllMocks(); });

const pv = (id: string, extra: Partial<PlayerView> = {}): PlayerView => ({
  id, nickname: id, appearance: { hair: 'short', hairColor: '#111111', shirtColor: '#222222' },
  isNpc: false, x: 3, z: 18, ry: 0, zone: 'lounge', seatId: null, status: { kind: 'none' }, drink: null, ...extra,
});

describe('RemotePlayers.views', () => {
  test('reuses one output array (no per-frame allocation) with the current views', () => {
    const r = new RemotePlayers(new THREE.Scene());
    r.upsert(pv('a'));
    r.upsert(pv('b'));
    const first = r.views();
    expect(first.map((v) => v.id)).toEqual(['a', 'b']);
    r.remove('a', false);
    const second = r.views();
    expect(second).toBe(first);
    expect(second.map((v) => v.id)).toEqual(['b']);
    r.clear();
  });
});

describe('RemotePlayers.forEachPosition', () => {
  test('reports every drawn avatar, seated ones at their seat (feeds study-room occupancy)', () => {
    const r = new RemotePlayers(new THREE.Scene());
    r.upsert(pv('walker', { x: 20, z: 16 }));
    r.upsert(pv('npc', { isNpc: true, seatId: 'B2', x: 0, z: 0 }));
    r.update(16, 0, () => 1);
    const seen: [number, number][] = [];
    r.forEachPosition((x, z) => seen.push([x, z]));
    expect(seen).toEqual([[20, 16], [26, 20.45]]); // B2: x 26, z 21.5 − 1.05
    r.clear();
  });
});

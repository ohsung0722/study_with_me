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

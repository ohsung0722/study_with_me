import { describe, expect, test } from 'vitest';
import type { PlayerView, Status } from '@studyverse/shared';
import { labelText } from '../src/three/label';

const view = (status: Status, extra: Partial<PlayerView> = {}): PlayerView => ({
  id: 'p1', nickname: '민수', appearance: { hair: 'short', hairColor: '#111111', shirtColor: '#222222' },
  isNpc: false, x: 0, z: 0, ry: 0, zone: 'reading', seatId: null, status, drink: null, ...extra,
});

describe('labelText', () => {
  test('labelText uses serverNow, not local clock', () => {
    // Review Focus 1: a client clock that is 10 minutes off must not leak into the timer.
    const realNow = Date.now;
    Date.now = () => 1_005_000 + 10 * 60_000;
    try {
      const r = labelText(view({ kind: 'studying', startedAt: 1_000_000, focus: false }), 1_005_000);
      expect(r).toEqual({ text: '민수 00:00:05', style: 'normal' });
    } finally {
      Date.now = realNow;
    }
  });

  test('studying in focus mode gets a lock prefix and focus style; me keeps style me', () => {
    const v = view({ kind: 'studying', startedAt: 0, focus: true });
    expect(labelText(v, 3_723_000)).toEqual({ text: '🔒 민수 01:02:03', style: 'focus' });
    expect(labelText(v, 3_723_000, true)).toEqual({ text: '🔒 민수 01:02:03', style: 'me' });
  });

  test('none → nickname; isMe → style me', () => {
    expect(labelText(view({ kind: 'none' }), 0)).toEqual({ text: '민수', style: 'normal' });
    expect(labelText(view({ kind: 'none' }), 0, true)).toEqual({ text: '민수', style: 'me' });
  });

  test('labelText break counts down and clamps at 00:00; npc shows 메이트', () => {
    const b = view({ kind: 'break', endsAt: 600_000 });
    expect(labelText(b, 0).text).toBe('민수 휴식 10:00');
    expect(labelText(b, 599_000).text).toBe('민수 휴식 00:01');
    expect(labelText(b, 700_000)).toEqual({ text: '민수 휴식 00:00', style: 'normal' });

    const npc = view({ kind: 'studying', startedAt: 0, focus: true }, { isNpc: true, nickname: '메이트' });
    expect(labelText(npc, 65_000)).toEqual({ text: '메이트 00:01:05', style: 'npc' });
    expect(labelText(view({ kind: 'none' }, { isNpc: true }), 0)).toEqual({ text: '메이트', style: 'npc' });
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { JoinOk, JoinResult, Profile } from '@studyverse/shared';
import { JOIN_RETRY_MS, joinWithRetry } from '../src/joinFlow';

const profile: Profile = {
  anonId: 'a', nickname: '민수', appearance: { hair: 'short', hairColor: '#000000', shirtColor: '#ffffff' }, breakMinutes: 10,
};

function fakeConn(results: (JoinResult | 'timeout')[]) {
  const log: string[] = [];
  const socket = {
    sendBuffer: [{ stale: true }] as unknown[],
    disconnect: vi.fn(() => { log.push('disconnect'); return socket; }),
    connect: vi.fn(() => { log.push('connect'); return socket; }),
  };
  const conn = {
    socket,
    serverOffsetMs: 0,
    join: vi.fn(async () => {
      log.push('join');
      const r = results.shift()!;
      if (r === 'timeout') throw new Error('join timeout');
      return r;
    }),
  };
  return { conn, socket, log };
}

const ok: JoinOk = { ok: true, selfId: 's', serverNow: 0, players: [], today: { dayKey: 'd', people: 0, totalSec: 0, top5: [] }, myTodaySec: 0 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('joinWithRetry', () => {
  test('resolves with the first ok result', async () => {
    const { conn } = fakeConn([ok]);
    await expect(joinWithRetry(conn as never, profile)).resolves.toEqual(ok);
  });

  test('nickname rejection is returned, not retried', async () => {
    const { conn } = fakeConn([{ ok: false, reason: 'nickname' }]);
    await expect(joinWithRetry(conn as never, profile)).resolves.toEqual({ ok: false, reason: 'nickname' });
    expect(conn.join).toHaveBeenCalledTimes(1);
  });

  test('full: reports it and retries after JOIN_RETRY_MS on the same socket', async () => {
    const { conn, socket } = fakeConn([{ ok: false, reason: 'full' }, ok]);
    const onFull = vi.fn();
    const p = joinWithRetry(conn as never, profile, { onFull });
    await vi.advanceTimersByTimeAsync(0);
    expect(onFull).toHaveBeenCalledTimes(1);
    expect(conn.join).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(JOIN_RETRY_MS);
    await expect(p).resolves.toEqual(ok);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  test('timeout (R21): drops buffered packets and reconnects the socket (fresh connId) before joining again', async () => {
    const { conn, socket, log } = fakeConn(['timeout', ok]);
    const p = joinWithRetry(conn as never, profile);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['join', 'disconnect', 'connect']);
    expect(socket.sendBuffer).toEqual([]);
    await vi.advanceTimersByTimeAsync(JOIN_RETRY_MS);
    await expect(p).resolves.toEqual(ok);
    expect(log).toEqual(['join', 'disconnect', 'connect', 'join']);
  });

  test('cancelled -> resolves null without joining again', async () => {
    const { conn } = fakeConn([{ ok: false, reason: 'full' }, ok]);
    let cancelled = false;
    const p = joinWithRetry(conn as never, profile, { cancelled: () => cancelled });
    await vi.advanceTimersByTimeAsync(0);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(JOIN_RETRY_MS);
    await expect(p).resolves.toBeNull();
    expect(conn.join).toHaveBeenCalledTimes(1);
  });
});

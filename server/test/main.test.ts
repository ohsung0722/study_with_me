import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { kstDayKey, type JoinResult, type Profile, type SitResult } from '@studyverse/shared';
import { openStore } from '../src/store/store';
import { startServer } from '../src/main';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const prof: Profile = {
  anonId: 'persist-1', nickname: '가나다', breakMinutes: 10,
  appearance: { hair: 'short', hairColor: '#000000', shirtColor: '#3366ff' },
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'studyverse-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test('startServer close() persists a seated client session', async () => {
  const dbPath = join(dir, 'nested', 'test.db');
  const srv = await startServer({ port: 0, dbPath });
  const c: Socket = connect(`http://localhost:${srv.port}`, { transports: ['websocket'], forceNew: true });
  try {
    await new Promise<void>((r) => c.once('connect', () => r()));
    const j = await new Promise<JoinResult>((r) => c.emit('join', prof, r));
    expect(j.ok).toBe(true);
    // spawn (14.5,23) in corridor -> studyB door (x=16, z 20-22) -> near seat B1 (22.5, 19.95)
    const corrections: unknown[] = [];
    c.on('correct', (p) => corrections.push(p));
    const waypoints: [number, number][] = [[14.5, 23], [14.5, 21], [20.5, 21], [21.5, 19.9]];
    // Steps <= 0.45 m: always within the server's speed budget (0.5 m + WALK_SPEED*dt*1.5), whatever the timer jitter.
    for (let i = 1; i < waypoints.length; i++) {
      const [x0, z0] = waypoints[i - 1], [x1, z1] = waypoints[i];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.45);
      for (let k = 1; k <= n; k++) {
        await sleep(100);
        c.emit('move', { x: x0 + ((x1 - x0) * k) / n, z: z0 + ((z1 - z0) * k) / n, ry: 0 });
      }
    }
    await sleep(150);
    expect(corrections, 'server rejected a move').toEqual([]);
    const s = await new Promise<SitResult>((r) => c.emit('sit', { seatId: 'B1' }, r));
    expect(s).toEqual({ ok: true });
    await sleep(1100);
  } finally {
    await srv.close();
    await srv.close(); // idempotent
    c.disconnect();
  }
  const store = openStore(dbPath);
  try {
    expect(store.userDaySec('persist-1', kstDayKey(Date.now()))).toBeGreaterThan(0);
  } finally { store.close(); }
});

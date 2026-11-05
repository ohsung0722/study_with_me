import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { MAP, type ClientToServer, type JoinResult, type Profile, type ServerToClient } from '@studyverse/shared';
import { World } from '../src/game/world';
import { openStore } from '../src/store/store';
import { attachSocketTransport } from '../src/net/socketTransport';

type CSocket = Socket<ServerToClient, ClientToServer>;

const prof = (anonId: string, nickname: string): Profile => ({
  anonId, nickname, breakMinutes: 10, appearance: { hair: 'short', hairColor: '#000000', shirtColor: '#3366ff' },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const once = <T>(s: CSocket, ev: string) => new Promise<T>((res) => (s as Socket).once(ev, (v: T) => res(v)));
const ack = <T>(emit: (cb: (r: T) => void) => void) => new Promise<T>((res) => emit(res));

let http: HttpServer;
let io: Server<ClientToServer, ServerToClient>;
let stop: () => void;
let world: World;
let clients: CSocket[] = [];

beforeEach(async () => {
  http = createServer();
  io = new Server(http);
  const t = attachSocketTransport(io, (out) => (world = new World({ now: Date.now, store: openStore(':memory:'), out })));
  stop = t.stop;
  await new Promise<void>((r) => http.listen(0, r));
});
afterEach(async () => {
  for (const c of clients) c.disconnect();
  clients = [];
  stop();
  await io.close();
});

async function client(): Promise<CSocket> {
  const c: CSocket = connect(`http://localhost:${(http.address() as AddressInfo).port}`, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  await once(c, 'connect');
  return c;
}
const join = (c: CSocket, p: Profile) => ack<JoinResult>((cb) => c.emit('join', p, cb));

describe('socket transport', () => {
  test('two clients: B sees A join, A moves, B receives snapshot', async () => {
    const a = await client(); const b = await client();
    expect((await join(b, prof('B', '라마바'))).ok).toBe(true);
    const joined = once<{ nickname: string }>(b, 'playerJoined');
    const ra = await join(a, prof('A', '가나다'));
    expect(ra.ok).toBe(true);
    expect((await joined).nickname).toBe('가나다');
    const snap = once<{ moved: { id: string; x: number; z: number }[] }>(b, 'snapshot');
    await sleep(100);
    a.emit('move', { x: MAP.spawn.x + 0.5, z: MAP.spawn.z, ry: 1 });
    const s = await snap;
    expect(s.moved[0]).toMatchObject({ id: a.id, x: MAP.spawn.x + 0.5 });
  });

  test('A greets B nearby → B gets greeted, both get wave', async () => {
    const a = await client(); const b = await client();
    await join(a, prof('A', '가나다')); await join(b, prof('B', '라마바'));
    const greeted = once<{ fromId: string; fromNick: string }>(b, 'greeted');
    const waveA = once<{ id: string }>(a, 'wave');
    const waveB = once<{ id: string }>(b, 'wave');
    const r = await ack((cb) => a.emit('greet', cb as never));
    expect(r).toEqual({ ok: true, targetId: b.id });
    expect(await greeted).toEqual({ fromId: a.id, fromNick: '가나다' });
    expect(await waveA).toEqual({ id: a.id });
    expect(await waveB).toEqual({ id: a.id });
  });

  test('second socket with same anonId → first receives replaced and is disconnected', async () => {
    const a1 = await client(); const a2 = await client();
    await join(a1, prof('SAME', '가나다'));
    const replaced = once(a1, 'replaced');
    const gone = once(a1, 'disconnect');
    expect((await join(a2, prof('SAME', '가나다'))).ok).toBe(true);
    await replaced; await gone;
    await sleep(50);
    expect(world.realCount()).toBe(1);
    expect(world.view(a2.id!)).toBeDefined();
  });

  test('malformed payloads are ignored without crashing', async () => {
    const a = await client(); const b = await client();
    await join(a, prof('A', '가나다')); await join(b, prof('B', '라마바'));
    const before = world.view(a.id!)!;
    const bad: unknown[] = [null, 'x', 5, { x: 'a', z: 1, ry: 0 }, { x: NaN, z: 1, ry: 0 }, { x: Infinity, z: 1, ry: 0 }, {}];
    for (const m of bad) (a as Socket).emit('move', m);
    (a as Socket).emit('drink', { drink: 'beer' }, () => {});
    (a as Socket).emit('drink', null, 'notfn');
    (a as Socket).emit('setBreakMinutes', { minutes: 7 });
    (a as Socket).emit('sit', { seatId: 5 }, () => {});
    (a as Socket).emit('greetAccept', { fromId: 3 });
    (a as Socket).emit('greet', 'notfn');
    (a as Socket).emit('seatToday', { seatId: {} });
    await sleep(150);
    expect(world.view(a.id!)).toEqual(before);
    // still alive
    expect(await ack<{ sec: number }>((cb) => a.emit('seatToday', { seatId: 'R01' }, cb))).toEqual({ sec: 0 });
    expect(a.connected).toBe(true);
  });

  test('bad join shape acks nickname; events before join are ignored', async () => {
    const a = await client();
    const bad = { ...prof('A', '가나다'), appearance: { hair: 'mohawk', hairColor: 'red', shirtColor: '#3366ff' } };
    expect(await join(a, bad as unknown as Profile)).toEqual({ ok: false, reason: 'nickname' });
    expect(world.realCount()).toBe(0);
    let answered = false;
    a.emit('seatToday', { seatId: 'R01' }, () => { answered = true; });
    a.emit('move', { x: 1, z: 1, ry: 0 });
    await sleep(100);
    expect(answered).toBe(false);
    expect((await join(a, prof('A', '가나다'))).ok).toBe(true);
  });

  test('unjoined sockets receive no broadcasts', async () => {
    const lurker = await client(); const a = await client(); const b = await client();
    const seen: string[] = [];
    for (const ev of ['snapshot', 'playerJoined', 'playerUpdated', 'wave', 'today', 'playerLeft']) (lurker as Socket).on(ev, () => seen.push(ev));
    await join(b, prof('B', '라마바'));
    await join(a, prof('A', '가나다'));
    await sleep(100);
    a.emit('move', { x: MAP.spawn.x + 0.5, z: MAP.spawn.z, ry: 1 });
    await ack((cb) => a.emit('greet', cb as never));
    await sleep(250);
    a.disconnect();
    await sleep(100);
    expect(seen).toEqual([]);
  });

  test('seatToday acks 0 for unknown seat', async () => {
    const a = await client();
    await join(a, prof('A', '가나다'));
    expect(await ack<{ sec: number }>((cb) => a.emit('seatToday', { seatId: 'nope' }, cb))).toEqual({ sec: 0 });
  });
});

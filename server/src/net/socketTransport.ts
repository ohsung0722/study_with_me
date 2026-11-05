import type { Server, Socket } from 'socket.io';
import {
  DRINKS, HAIR_STYLES, TICK_HZ,
  type ClientToServer, type DrinkId, type Profile, type ServerToClient,
} from '@studyverse/shared';
import type { Outbox } from '../game/outbox';
import type { World } from '../game/world';

type IO = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient>;

const HEX = /^#[0-9a-fA-F]{6}$/;
const DRINK_IDS: readonly string[] = Object.values(DRINKS).flat();

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isMinutes = (v: unknown): v is 5 | 10 | 15 => v === 5 || v === 10 || v === 15;
const isFn = (v: unknown): v is (...a: never[]) => void => typeof v === 'function';

function parseProfile(v: unknown): Profile | null {
  if (!isObj(v) || !isObj(v.appearance)) return null;
  const a = v.appearance;
  if (typeof v.anonId !== 'string' || v.anonId.length === 0 || v.anonId.length > 100) return null;
  if (typeof v.nickname !== 'string' || v.nickname.length > 100) return null;
  if (!(HAIR_STYLES as readonly unknown[]).includes(a.hair)) return null;
  if (typeof a.hairColor !== 'string' || !HEX.test(a.hairColor)) return null;
  if (typeof a.shirtColor !== 'string' || !HEX.test(a.shirtColor)) return null;
  if (!isMinutes(v.breakMinutes)) return null;
  return {
    anonId: v.anonId, nickname: v.nickname, breakMinutes: v.breakMinutes,
    appearance: { hair: a.hair as Profile['appearance']['hair'], hairColor: a.hairColor, shirtColor: a.shirtColor },
  };
}

export function attachSocketTransport(
  io: IO,
  makeWorld: (out: Outbox) => World,
): { world: World; stop(): void } {
  const rooms = new Map<string, string>(); // socket id -> current room

  const out: Outbox = {
    toAll: (ev, ...a) => { (io.emit as (e: string, ...x: unknown[]) => void)(ev, ...a); },
    toAllExcept: (id, ev, ...a) => { (io.except(id).emit as (e: string, ...x: unknown[]) => void)(ev, ...a); },
    toPlayer: (id, ev, ...a) => { (io.to(id).emit as (e: string, ...x: unknown[]) => void)(ev, ...a); },
    setRoom(id, room) {
      const s = io.sockets.sockets.get(id);
      const prev = rooms.get(id);
      if (prev === room || (prev === undefined && room === null)) return;
      if (prev !== undefined) { s?.leave(prev); rooms.delete(id); }
      if (room !== null && s) { s.join(room); rooms.set(id, room); }
    },
    kick(id, ev) {
      const s = io.sockets.sockets.get(id);
      if (!s) return;
      s.emit(ev);
      s.disconnect(true);
    },
  };

  const world = makeWorld(out);

  const safe = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
    try { fn(...a); } catch (e) { console.error('[transport] handler error', e); }
  };

  io.on('connection', (socket: Sock) => {
    const id = socket.id;
    let joined = false;
    const s = socket as unknown as { on(ev: string, fn: (...a: unknown[]) => void): void };
    const on = (ev: string, fn: (...a: unknown[]) => void) => s.on(ev, safe(fn));
    const reply = <T>(cb: unknown, r: T) => { if (isFn(cb)) (cb as (r: T) => void)(r); };

    on('join', (p, cb) => {
      if (joined) return;
      const profile = parseProfile(p);
      if (!profile) return reply(cb, { ok: false, reason: 'nickname' });
      const r = world.join(id, profile);
      if (r.ok) joined = true;
      reply(cb, r);
    });
    on('move', (m) => {
      if (!joined || !isObj(m) || !isNum(m.x) || !isNum(m.z) || !isNum(m.ry)) return;
      world.move(id, m.x, m.z, m.ry);
    });
    on('sit', (m, cb) => {
      if (!joined || !isFn(cb) || !isObj(m) || typeof m.seatId !== 'string') return;
      reply(cb, world.sit(id, m.seatId));
    });
    on('stand', () => { if (joined) world.stand(id); });
    on('greet', (cb) => {
      if (!joined || !isFn(cb)) return;
      reply(cb, world.greet(id));
    });
    on('greetAccept', (m) => {
      if (!joined || !isObj(m) || typeof m.fromId !== 'string') return;
      world.greetAccept(id, m.fromId);
    });
    on('drink', (m, cb) => {
      if (!joined || !isFn(cb) || !isObj(m) || typeof m.drink !== 'string' || !DRINK_IDS.includes(m.drink)) return;
      reply(cb, { ok: world.takeDrink(id, m.drink as DrinkId) });
    });
    on('setBreakMinutes', (m) => {
      if (!joined || !isObj(m) || !isMinutes(m.minutes)) return;
      world.setBreakMinutes(id, m.minutes);
    });
    on('seatToday', (m, cb) => {
      if (!joined || !isFn(cb) || !isObj(m) || typeof m.seatId !== 'string') return;
      reply(cb, { sec: world.seatTodaySec(m.seatId) });
    });
    socket.on('disconnect', safe(() => {
      rooms.delete(id);
      world.leave(id);
    }));
  });

  const timer = setInterval(safe(() => world.tick()), 1000 / TICK_HZ);
  return { world, stop: () => clearInterval(timer) };
}

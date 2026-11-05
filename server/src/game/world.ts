import { isDeepStrictEqual } from 'node:util';
import {
  BUILDING_CAPACITY, BUILDING_ID, DRINKS, DRINK_LIFETIME_MS, GREET_TOAST_MS, INTERACT_RANGE, MAP, PLAYER_RADIUS, TODAY_BROADCAST_MS, WALK_SPEED,
  isBlocked, kstDayKey, seatById, validateNickname, zoneAt,
  type DrinkId, type GreetResult, type JoinResult, type PlayerView, type Profile, type SitResult, type TodayStats,
} from '@studyverse/shared';
import { computeToday } from './today';
import { pickGreetTarget } from './greetings';
import { NPC_SEATS, makeNpc, npcTarget } from './npc';
import type { RecordStore } from '../store/store';
import type { Outbox } from './outbox';

export interface WorldDeps { now: () => number; store: RecordStore; out: Outbox; rand?: () => number }

export interface PlayerState extends PlayerView {
  anonId: string;
  lastMoveAt: number;
  lastGreetAt: number;
  breakMinutes: 5 | 10 | 15;
  connected: boolean;
}

const toView = (p: PlayerState): PlayerView => ({
  id: p.id, nickname: p.nickname, appearance: p.appearance, isNpc: p.isNpc,
  x: p.x, z: p.z, ry: p.ry, zone: p.zone, seatId: p.seatId, status: p.status, drink: p.drink,
});

export class World {
  private players = new Map<string, PlayerState>();
  private movedIds = new Set<string>();
  private lastTodayAt: number;
  private lastToday: TodayStats | null = null;
  private pendingGreets = new Map<string, { fromId: string; at: number }>(); // target id -> latest greet

  constructor(private deps: WorldDeps) {
    this.lastTodayAt = deps.now();
  }

  join(connId: string, profile: Profile): JoinResult {
    const { now, store, out } = this.deps;
    const nick = validateNickname(profile.nickname);
    if (!nick.ok) return { ok: false, reason: 'nickname' };
    for (const p of [...this.players.values()]) {
      if (!p.isNpc && p.anonId === profile.anonId) {
        this.saveSession(p);
        out.kick(p.id, 'replaced');
        this.players.delete(p.id);
        this.movedIds.delete(p.id);
        out.setRoom(p.id, null);
        out.toAllExcept(connId, 'playerLeft', { id: p.id, npc: false });
      }
    }

    if (this.realCount() >= BUILDING_CAPACITY) return { ok: false, reason: 'full' };

    store.upsertProfile(profile.anonId, nick.value);
    const sp = MAP.spawn;
    const t = now();
    const p: PlayerState = {
      id: connId, nickname: store.displayName(profile.anonId), appearance: profile.appearance, isNpc: false,
      x: sp.x, z: sp.z, ry: sp.facing, zone: zoneAt(sp.x, sp.z), seatId: null, status: { kind: 'none' }, drink: null,
      anonId: profile.anonId, lastMoveAt: t, lastGreetAt: -Infinity, breakMinutes: profile.breakMinutes, connected: true,
    };
    this.players.set(connId, p);
    out.setRoom(connId, p.zone ? `${BUILDING_ID}:${p.zone}` : null);
    out.toAllExcept(connId, 'playerJoined', toView(p));

    const day = kstDayKey(t);
    return {
      ok: true, selfId: connId, serverNow: t,
      players: [...this.players.values()].map(toView),
      today: this.liveToday(),
      myTodaySec: store.userDaySec(profile.anonId, day),
    };
  }

  leave(connId: string): void {
    const p = this.players.get(connId);
    if (!p) return;
    this.saveSession(p);
    this.players.delete(connId);
    this.movedIds.delete(connId);
    this.pendingGreets.delete(connId);
    this.deps.out.setRoom(connId, null);
    this.deps.out.toAllExcept(connId, 'playerLeft', { id: connId, npc: false });
  }

  move(connId: string, x: number, z: number, ry: number): void {
    const p = this.players.get(connId);
    if (!p || p.seatId) return;
    const { now, out } = this.deps;
    const t = now();
    const dt = Math.max(0, (t - p.lastMoveAt) / 1000);
    const valid = Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(ry)
      && Math.hypot(x - p.x, z - p.z) <= WALK_SPEED * dt * 1.5 + 0.5
      && !isBlocked(x, z, PLAYER_RADIUS * 0.5)
      && zoneAt(x, z) !== null;
    if (!valid) {
      out.toPlayer(connId, 'correct', { x: p.x, z: p.z });
      return;
    }
    p.x = x; p.z = z; p.ry = ry;
    p.lastMoveAt = t;
    this.movedIds.add(connId);

    const zone = zoneAt(x, z);
    if (zone !== p.zone) {
      p.zone = zone;
      out.setRoom(connId, zone ? `${BUILDING_ID}:${zone}` : null);
      if (zone === 'lounge' && p.status.kind !== 'studying') {
        p.status = { kind: 'break', endsAt: t + p.breakMinutes * 60000 };
      } else if (zone !== 'lounge' && p.status.kind === 'break') {
        p.status = { kind: 'none' };
      }
      out.toAll('playerUpdated', toView(p));
    }
  }

  setBreakMinutes(connId: string, minutes: 5 | 10 | 15): void {
    const p = this.players.get(connId);
    if (!p || (minutes !== 5 && minutes !== 10 && minutes !== 15)) return;
    p.breakMinutes = minutes;
    if (p.status.kind === 'break') {
      p.status = { kind: 'break', endsAt: this.deps.now() + minutes * 60000 };
      this.deps.out.toAll('playerUpdated', toView(p));
    }
  }

  /** Called at TICK_HZ: position snapshot of movers, then the periodic live "today" stats. */
  tick(): void {
    const { now, out } = this.deps;
    const t = now();
    this.syncNpcs(t);
    for (const p of this.players.values()) {
      if (p.drink && t >= p.drink.until) {
        p.drink = null;
        out.toAll('playerUpdated', toView(p));
      }
    }
    if (this.movedIds.size > 0) {
      const moved = [...this.movedIds].flatMap((id) => {
        const p = this.players.get(id);
        return p ? [{ id, x: p.x, z: p.z, ry: p.ry }] : [];
      });
      this.movedIds.clear();
      if (moved.length > 0) out.toAll('snapshot', { t, moved });
    }
    if (t - this.lastTodayAt >= TODAY_BROADCAST_MS) {
      this.lastTodayAt = t;
      const today = this.liveToday();
      if (!isDeepStrictEqual(today, this.lastToday)) {
        this.lastToday = today;
        out.toAll('today', today);
      }
    }
  }

  sit(connId: string, seatId: string): SitResult {
    const p = this.players.get(connId);
    const seat = seatById(seatId);
    if (!p || !seat) return { ok: false, reason: 'unknown' };
    for (const o of this.players.values()) if (o.seatId === seatId) return { ok: false, reason: 'taken' };
    if (p.seatId) return { ok: false, reason: 'taken' };
    if (zoneAt(p.x, p.z) !== seat.zone) return { ok: false, reason: 'far' }; // no sitting through walls
    if (Math.hypot(p.x - seat.x, p.z - seat.z) > INTERACT_RANGE + 0.5) return { ok: false, reason: 'far' };
    p.x = seat.x; p.z = seat.z; p.ry = seat.facing;
    p.seatId = seat.id;
    if (seat.kind !== 'sofa') p.status = { kind: 'studying', startedAt: this.deps.now(), focus: seat.kind === 'desk' };
    this.deps.out.toAll('playerUpdated', toView(p));
    return { ok: true };
  }

  stand(connId: string): void {
    const p = this.players.get(connId);
    if (!p || !p.seatId) return;
    const wasStudying = p.status.kind === 'studying';
    this.saveSession(p);
    p.seatId = null;
    if (wasStudying) {
      p.status = { kind: 'none' };
      this.deps.out.toPlayer(connId, 'myToday', {
        sec: this.deps.store.userDaySec(p.anonId, kstDayKey(this.deps.now())),
      });
    }
    this.deps.out.toAll('playerUpdated', toView(p));
  }

  greet(connId: string): GreetResult {
    const p = this.players.get(connId);
    if (!p) return { ok: false, reason: 'noTarget' };
    const { now, out } = this.deps;
    const t = now();
    const r = pickGreetTarget(p, [...this.players.values()].map(toView), t);
    if (!r.ok) return r;
    p.lastGreetAt = t;
    this.pendingGreets.set(r.targetId, { fromId: connId, at: t });
    out.toAll('wave', { id: connId });
    out.toPlayer(r.targetId, 'greeted', { fromId: connId, fromNick: p.nickname });
    return r;
  }

  greetAccept(connId: string, fromId: string): void {
    if (!this.players.has(connId)) return;
    const g = this.pendingGreets.get(connId);
    if (!g || g.fromId !== fromId || this.deps.now() - g.at > GREET_TOAST_MS) return;
    this.pendingGreets.delete(connId);
    this.deps.out.toAll('wave', { id: connId });
  }

  takeDrink(connId: string, drink: DrinkId): boolean {
    const p = this.players.get(connId);
    if (!p) return false;
    const machine = (Object.keys(DRINKS) as (keyof typeof DRINKS)[]).find((m) => (DRINKS[m] as readonly string[]).includes(drink));
    const spot = machine && MAP.interactables.find((i) => i.id === machine);
    if (!spot || Math.hypot(p.x - spot.x, p.z - spot.z) > INTERACT_RANGE) return false;
    p.drink = { id: drink, until: this.deps.now() + DRINK_LIFETIME_MS };
    this.deps.out.toAll('playerUpdated', toView(p));
    return true;
  }

  view(id: string): PlayerView | undefined {
    const p = this.players.get(id);
    return p ? toView(p) : undefined;
  }

  realCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.isNpc) n++;
    return n;
  }

  shutdown(): void {
    for (const p of this.players.values()) this.saveSession(p);
  }

  /** Bring the NPC count in line with npcTarget(realCount()); highest index leaves first. */
  private syncNpcs(t: number): void {
    const { out } = this.deps;
    const rand = this.deps.rand ?? Math.random;
    const target = npcTarget(this.realCount());
    const npcs = [...this.players.values()].filter((p) => p.isNpc);
    for (let i = npcs.length - 1; i >= target; i--) {
      this.players.delete(npcs[i].id);
      this.movedIds.delete(npcs[i].id);
      out.toAll('playerLeft', { id: npcs[i].id, npc: true });
    }
    for (let i = npcs.length; i < target; i++) {
      const seatId = this.npcSeat(i);
      if (!seatId) continue;
      const v = makeNpc(i, t, rand, seatId);
      const p: PlayerState = { ...v, anonId: '', lastMoveAt: t, lastGreetAt: -Infinity, breakMinutes: 10, connected: true };
      this.players.set(p.id, p);
      out.toAll('playerJoined', toView(p));
    }
  }

  /** NPC_SEATS[index] if free, else the free desk with the highest seat id. */
  private npcSeat(index: number): string | null {
    const taken = new Set<string>();
    for (const p of this.players.values()) if (p.seatId) taken.add(p.seatId);
    if (!taken.has(NPC_SEATS[index])) return NPC_SEATS[index];
    const free = MAP.seats.filter((s) => s.kind === 'desk' && !taken.has(s.id)).map((s) => s.id).sort();
    return free.length ? free[free.length - 1] : null;
  }

  private liveToday(): TodayStats {
    return computeToday(this.deps.store, BUILDING_ID, this.players.values(), this.deps.now());
  }

  /** Persist an open studying session ending now; restarts the timer so it is never double counted. */
  private saveSession(p: PlayerState): void {
    if (p.isNpc || p.status.kind !== 'studying' || !p.seatId) return;
    const end = this.deps.now();
    if (end <= p.status.startedAt) return;
    this.deps.store.addSession({
      anonId: p.anonId, buildingId: BUILDING_ID, seatId: p.seatId, startMs: p.status.startedAt, endMs: end,
    });
    p.status = { ...p.status, startedAt: end };
  }
}

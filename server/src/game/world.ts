import {
  BUILDING_CAPACITY, BUILDING_ID, INTERACT_RANGE, MAP, kstDayKey, seatById, validateNickname, zoneAt,
  type JoinResult, type PlayerView, type Profile, type SitResult,
} from '@studyverse/shared';
import type { RecordStore } from '../store/store';
import type { Outbox } from './outbox';

export interface WorldDeps { now: () => number; store: RecordStore; out: Outbox }

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

  constructor(private deps: WorldDeps) {}

  join(connId: string, profile: Profile): JoinResult {
    const { now, store, out } = this.deps;
    const nick = validateNickname(profile.nickname);
    if (!nick.ok) return { ok: false, reason: 'nickname' };
    if (this.realCount() >= BUILDING_CAPACITY) return { ok: false, reason: 'full' };

    for (const p of [...this.players.values()]) {
      if (!p.isNpc && p.anonId === profile.anonId) {
        this.saveSession(p);
        out.kick(p.id, 'replaced');
        this.players.delete(p.id);
        out.setRoom(p.id, null);
        out.toAllExcept(connId, 'playerLeft', { id: p.id, npc: false });
      }
    }

    store.upsertProfile(profile.anonId, nick.value);
    const sp = MAP.spawn;
    const t = now();
    const p: PlayerState = {
      id: connId, nickname: store.displayName(profile.anonId), appearance: profile.appearance, isNpc: false,
      x: sp.x, z: sp.z, ry: sp.facing, zone: zoneAt(sp.x, sp.z), seatId: null, status: { kind: 'none' }, drink: null,
      anonId: profile.anonId, lastMoveAt: t, lastGreetAt: 0, breakMinutes: profile.breakMinutes, connected: true,
    };
    this.players.set(connId, p);
    out.setRoom(connId, p.zone ? `${BUILDING_ID}:${p.zone}` : null);
    out.toAllExcept(connId, 'playerJoined', toView(p));

    const day = kstDayKey(t);
    return {
      ok: true, selfId: connId, serverNow: t,
      players: [...this.players.values()].map(toView),
      today: store.todayStats(day, BUILDING_ID),
      myTodaySec: store.userDaySec(profile.anonId, day),
    };
  }

  leave(connId: string): void {
    const p = this.players.get(connId);
    if (!p) return;
    this.saveSession(p);
    this.players.delete(connId);
    this.deps.out.setRoom(connId, null);
    this.deps.out.toAllExcept(connId, 'playerLeft', { id: connId, npc: false });
  }

  // Minimal movement (Task 6 adds validation, zones, snapshots).
  move(connId: string, x: number, z: number, ry: number): void {
    const p = this.players.get(connId);
    if (!p || p.seatId) return;
    p.x = x; p.z = z; p.ry = ry;
    p.lastMoveAt = this.deps.now();
  }

  sit(connId: string, seatId: string): SitResult {
    const p = this.players.get(connId);
    const seat = seatById(seatId);
    if (!p || !seat) return { ok: false, reason: 'unknown' };
    for (const o of this.players.values()) if (o.seatId === seatId) return { ok: false, reason: 'taken' };
    if (p.seatId) return { ok: false, reason: 'taken' };
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

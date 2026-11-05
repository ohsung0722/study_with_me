import type { HAIR_STYLES } from './constants';
import type { ZoneId } from './map';

export type HairStyle = typeof HAIR_STYLES[number];
export type DrinkId = 'americano' | 'latte' | 'greenTea' | 'ionDrink';
export interface Appearance { hair: HairStyle; hairColor: string; shirtColor: string } // '#rrggbb'
export interface Profile { anonId: string; nickname: string; appearance: Appearance; breakMinutes: 5 | 10 | 15 }
export type Status =
  | { kind: 'none' }
  | { kind: 'studying'; startedAt: number; focus: boolean }
  | { kind: 'break'; endsAt: number };
export interface PlayerView {
  id: string; nickname: string; appearance: Appearance; isNpc: boolean;
  x: number; z: number; ry: number; zone: ZoneId | null; seatId: string | null; status: Status;
  drink: { id: DrinkId; until: number } | null;
}
export interface TodayStats { dayKey: string; people: number; totalSec: number; top5: { nickname: string; sec: number }[] }
export interface JoinOk { ok: true; selfId: string; serverNow: number; players: PlayerView[]; today: TodayStats; myTodaySec: number }
export type JoinResult = JoinOk | { ok: false; reason: 'full' | 'nickname' };
export type GreetResult = { ok: true; targetId: string } | { ok: false; reason: 'cooldown' | 'noTarget' | 'focus' };
export type SitResult = { ok: true } | { ok: false; reason: 'taken' | 'far' | 'unknown' };

export interface ClientToServer {
  join: (p: Profile, ack: (r: JoinResult) => void) => void;
  move: (m: { x: number; z: number; ry: number }) => void;
  sit: (m: { seatId: string }, ack: (r: SitResult) => void) => void;
  stand: () => void;
  greet: (ack: (r: GreetResult) => void) => void;
  greetAccept: (m: { fromId: string }) => void;
  drink: (m: { drink: DrinkId }, ack: (r: { ok: boolean }) => void) => void;
  setBreakMinutes: (m: { minutes: 5 | 10 | 15 }) => void;
  seatToday: (m: { seatId: string }, ack: (r: { sec: number }) => void) => void;
}

export interface ServerToClient {
  snapshot: (m: { t: number; moved: { id: string; x: number; z: number; ry: number }[] }) => void;
  playerJoined: (p: PlayerView) => void;
  playerUpdated: (p: PlayerView) => void;
  playerLeft: (m: { id: string; npc: boolean }) => void;
  correct: (m: { x: number; z: number }) => void;
  wave: (m: { id: string }) => void;
  greeted: (m: { fromId: string; fromNick: string }) => void;
  today: (s: TodayStats) => void;
  myToday: (m: { sec: number }) => void;
  replaced: () => void;
}

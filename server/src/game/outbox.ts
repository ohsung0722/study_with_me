import type { ServerToClient } from '@studyverse/shared';

export interface Outbox {
  toAll<K extends keyof ServerToClient>(ev: K, ...a: Parameters<ServerToClient[K]>): void;
  toAllExcept<K extends keyof ServerToClient>(id: string, ev: K, ...a: Parameters<ServerToClient[K]>): void;
  toPlayer<K extends keyof ServerToClient>(id: string, ev: K, ...a: Parameters<ServerToClient[K]>): void;
  setRoom(id: string, room: string | null): void; // `${BUILDING_ID}:${zone}`
  kick(id: string, ev: 'replaced'): void;
}

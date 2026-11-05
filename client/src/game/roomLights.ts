// Study-room lights that switch on while someone is inside. Occupancy is derived on each client from the player
// positions it already has (me, other players, NPCs): every frame the caller marks each position, then update()
// advances each room's light level. A room is on while anyone is in it; once it empties the light holds for
// ROOM_LIGHT_OFF_DELAY_MS, then fades off. Fading on/off takes ROOM_LIGHT_FADE_MS (linear level; the renderer may
// ease it). Everyone sees the same lit rooms, which doubles as a "room in use" signal from the corridor.
import { zoneAt, type ZoneId } from '@studyverse/shared';

export const LIT_ROOMS = ['studyA', 'studyB'] as const satisfies readonly ZoneId[];
export type LitRoom = (typeof LIT_ROOMS)[number];
export const ROOM_LIGHT_OFF_DELAY_MS = 3000;
export const ROOM_LIGHT_FADE_MS = 400;

/** One room's light: level 0..1 and how long it has been empty (ms). */
export interface RoomLightState { level: number; emptyMs: number }

/**
 * Advance one room by dtMs: occupied → fade on; empty → hold for the off delay, then fade off. Updates `s` in place
 * (no per-frame allocation) and returns it.
 */
export function stepRoomLight(s: RoomLightState, occupied: boolean, dtMs: number): RoomLightState {
  const dt = Math.max(0, dtMs);
  if (dt === 0) return s;
  const rate = 1 / ROOM_LIGHT_FADE_MS;
  if (occupied) {
    s.level = Math.min(1, s.level + dt * rate);
    s.emptyMs = 0;
    return s;
  }
  s.emptyMs += dt;
  const fadeMs = Math.min(dt, Math.max(0, s.emptyMs - ROOM_LIGHT_OFF_DELAY_MS)); // only the part past the delay fades
  s.level = Math.max(0, s.level - fadeMs * rate);
  return s;
}

/** Per-room light levels for the study rooms. mark() every player position, then update() once per frame. */
export class RoomLights {
  private readonly states: RoomLightState[] = LIT_ROOMS.map(() => ({ level: 0, emptyMs: 0 }));
  private readonly occupied: boolean[] = LIT_ROOMS.map(() => false);

  /** A player (me, another player or an NPC) is at (x, z) this frame. */
  mark(x: number, z: number): void {
    const zone = zoneAt(x, z);
    if (zone === null) return;
    const i = (LIT_ROOMS as readonly ZoneId[]).indexOf(zone);
    if (i >= 0) this.occupied[i] = true;
  }

  /** Advance every room by dtMs using this frame's marks, then clear the marks. */
  update(dtMs: number): void {
    for (let i = 0; i < this.states.length; i++) {
      stepRoomLight(this.states[i], this.occupied[i], dtMs);
      this.occupied[i] = false;
    }
  }

  /** Current light level (0..1) of a zone; 0 for zones without occupancy lights. */
  level(zone: ZoneId): number {
    const i = (LIT_ROOMS as readonly ZoneId[]).indexOf(zone);
    return i >= 0 ? this.states[i].level : 0;
  }
}

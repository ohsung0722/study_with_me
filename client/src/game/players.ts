// Avatars + name labels for players: my own (positioned by the Game) and everyone else (snapshot-interpolated).
// Remote pose: sit on a seat, walk while the rendered position moves, else stand. An NPC that leaves stands up,
// walks toward the reading-room door for 2 s while fading out, then disappears.
import * as THREE from 'three';
import { TICK_HZ, WALK_SPEED, seatById, type Appearance, type PlayerView, type Seat } from '@studyverse/shared';
import { createAvatar, type AvatarRig, type Pose } from '../three/avatar';
import { LabelSprite, labelText } from '../three/label';
import { Interpolator } from './remotes';

export const WALK_HOLD_MS = 150;  // keep walking across short gaps between 10 Hz snapshots
export const NPC_STAND_MS = 400;  // stand up before walking off
export const NPC_WALK_MS = 2000;
export const NPC_FADE_MS = 600;   // fade out during the last part of the walk
const LABEL_Y = 2.0;
const MOVE_EPS = 1e-3;

type Pt = { x: number; z: number };

export function remotePose(seated: boolean, movedM: number, dtMs: number, holdMs: number): { pose: Pose; holdMs: number } {
  const hold = movedM > MOVE_EPS ? WALK_HOLD_MS : Math.max(0, holdMs - dtMs);
  return { pose: seated ? 'sit' : hold > 0 ? 'walk' : 'stand', holdMs: hold };
}

const DOOR: Pt = { x: 16, z: 11 }; // reading room ↔ corridor door (x=16, z 10–12)
const AISLE_X = 17.0;              // free strip between the corridor wall and the first desk column

/** From a reading-room seat: step back from the desk, along the aisle behind the row, up the free strip, to the door. */
export function npcExitPath(seat: Seat): Pt[] {
  const back = { x: seat.x - Math.sin(seat.facing) * 0.45, z: seat.z - Math.cos(seat.facing) * 0.45 };
  return [{ x: seat.x, z: seat.z }, back, { x: AISLE_X, z: back.z }, { x: AISLE_X, z: DOOR.z }, { ...DOOR }];
}

/**
 * Point `dist` metres along the polyline (clamped), facing the current segment (forward = (sin ry, cos ry)).
 * `end` = the whole path is covered (stop walking there).
 */
export function pointAlong(path: Pt[], dist: number): { x: number; z: number; ry: number; end: boolean } {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  const done = dist >= total - 1e-9;
  let left = Math.min(Math.max(0, dist), total);
  let ry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-9) continue;
    ry = Math.atan2(b.x - a.x, b.z - a.z);
    if (left <= len) {
      const k = left / len;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, ry, end: done };
    }
    left -= len;
  }
  const last = path[path.length - 1];
  return { x: last.x, z: last.z, ry, end: true };
}

/** NPC leaving timeline at `elapsedMs`: stand up, walk for NPC_WALK_MS (fading at the end), then done. */
export function npcLeaveState(elapsedMs: number): { walking: boolean; distM: number; opacity: number; done: boolean } {
  const end = NPC_STAND_MS + NPC_WALK_MS;
  const done = elapsedMs >= end;
  const walkMs = Math.min(NPC_WALK_MS, Math.max(0, elapsedMs - NPC_STAND_MS));
  return {
    walking: !done && elapsedMs >= NPC_STAND_MS,
    distM: (walkMs / 1000) * WALK_SPEED,
    opacity: Math.min(1, Math.max(0, (end - elapsedMs) / NPC_FADE_MS)),
    done,
  };
}

/** One avatar with its label. */
export class Avatar {
  readonly rig: AvatarRig;
  private label = new LabelSprite();
  private fade = 1;

  constructor(scene: THREE.Scene, appearance: Appearance) {
    this.rig = createAvatar(appearance);
    this.label.object.position.y = LABEL_Y;
    this.rig.root.add(this.label.object);
    scene.add(this.rig.root);
  }

  place(x: number, z: number, ry: number, pose: Pose, dtMs: number): void {
    this.rig.root.position.set(x, 0, z);
    this.rig.root.rotation.y = ry;
    this.rig.setPose(pose);
    this.rig.update(dtMs);
  }

  /** Label text/style and zone dimming (`dim` = ZoneDimmer factor where the avatar stands). */
  paint(view: PlayerView, serverNow: number, isMe: boolean, dim: number): void {
    const { text, style } = labelText(view, serverNow, isMe);
    this.label.set(text, style);
    this.label.setOpacity((0.55 + 0.45 * dim) * this.fade);
    this.rig.setDim(dim);
  }

  /** My own label is hidden while I'm seated: the seated camera sits right behind it (the HUD shows 🔒/time). */
  setLabelVisible(on: boolean): void {
    this.label.object.visible = on;
  }

  /** Whole-avatar opacity (NPC exit). */
  setFade(o: number): void {
    if (o === this.fade) return;
    this.fade = o;
    this.rig.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const m = mesh.material;
      if (!m.transparent) { m.transparent = true; m.needsUpdate = true; }
      m.opacity = o;
    });
  }

  dispose(): void {
    this.label.dispose();
    this.rig.dispose();
  }
}

interface Remote {
  view: PlayerView;           // latest server view; x/z/ry follow the newest snapshot
  avatar: Avatar;
  interp: Interpolator;
  x: number; z: number;       // rendered position last frame
  hold: number;
  leaving: { t: number; path: Pt[]; seat: Seat } | null;
}

export class RemotePlayers {
  private map = new Map<string, Remote>();
  private viewsOut: PlayerView[] = [];

  constructor(private scene: THREE.Scene) {}

  /** Joined or updated. A seat change resets interpolation: the server moves sitters/standers without a snapshot. */
  upsert(v: PlayerView): void {
    let r = this.map.get(v.id);
    if (r?.leaving) { this.drop(v.id); r = undefined; } // same NPC id came back while walking out
    if (!r) {
      r = { view: { ...v }, avatar: new Avatar(this.scene, v.appearance), interp: new Interpolator(), x: v.x, z: v.z, hold: 0, leaving: null };
      this.map.set(v.id, r);
    } else {
      if (r.view.seatId !== v.seatId) r.interp.reset();
      r.view = { ...v };
    }
    r.avatar.rig.setDrink(v.drink?.id ?? null);
  }

  remove(id: string, npc: boolean): void {
    const r = this.map.get(id);
    if (!r || r.leaving) return;
    const seat = r.view.seatId ? seatById(r.view.seatId) : undefined;
    if (npc && seat) r.leaving = { t: 0, path: npcExitPath(seat), seat };
    else this.drop(id);
  }

  snapshot(t: number, moved: { id: string; x: number; z: number; ry: number }[]): void {
    for (const m of moved) {
      const r = this.map.get(m.id);
      if (!r || r.leaving) continue;
      // first snapshot after standing still: start the interpolation from where they were standing
      if (r.interp.sample(t) === null) r.interp.push(t - 1000 / TICK_HZ, r.view);
      r.interp.push(t, m);
      r.view.x = m.x; r.view.z = m.z; r.view.ry = m.ry;
    }
  }

  wave(id: string): void {
    this.map.get(id)?.avatar.rig.wave();
  }

  /**
   * Current server views of players who are still here (leaving NPCs excluded). Returns the same array every call
   * (refilled; no per-frame allocation): use it before the next call, don't keep it.
   */
  views(): PlayerView[] {
    const out = this.viewsOut;
    out.length = 0;
    for (const r of this.map.values()) if (!r.leaving) out.push(r.view);
    return out;
  }

  update(dtMs: number, serverNow: number, dimAt: (x: number, z: number) => number): void {
    for (const [id, r] of this.map) {
      let x: number, z: number, ry: number, pose: Pose;
      if (r.leaving) {
        r.leaving.t += dtMs;
        const st = npcLeaveState(r.leaving.t);
        if (st.done) { this.drop(id); continue; }
        pose = 'stand';
        if (st.walking) {
          const p = pointAlong(r.leaving.path, st.distM);
          ({ x, z, ry } = p);
          if (!p.end) pose = 'walk'; // at the door already: stand there and just fade
        } else {
          ({ x, z, facing: ry } = r.leaving.seat);
        }
        r.avatar.setFade(st.opacity);
      } else {
        const seat = r.view.seatId ? seatById(r.view.seatId) : undefined;
        const s = seat ? { x: seat.x, z: seat.z, ry: seat.facing } : r.interp.sample(serverNow) ?? r.view;
        ({ x, z, ry } = s);
        const p = remotePose(!!seat, Math.hypot(x - r.x, z - r.z), dtMs, r.hold);
        pose = p.pose;
        r.hold = p.holdMs;
      }
      r.x = x; r.z = z;
      r.avatar.place(x, z, ry, pose, dtMs);
      r.avatar.paint(r.view, serverNow, false, dimAt(x, z));
    }
  }

  clear(): void {
    for (const id of [...this.map.keys()]) this.drop(id);
  }

  private drop(id: string): void {
    this.map.get(id)?.avatar.dispose();
    this.map.delete(id);
  }
}

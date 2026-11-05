// Third-person camera rig: drag to rotate, wheel to zoom, wall occlusion pull-in, seated view.
import * as THREE from 'three';
import { MAP, type Seat, type ZoneId } from '@studyverse/shared';

const MIN_DIST = 2.5, MAX_DIST = 12;
const MIN_PITCH = 0.1, MAX_PITCH = 1.3;
const HEAD_Y = 1.4;
const SMOOTH_MS = 120;

type P3 = { x: number; y: number; z: number };

const SEATED_WALL_MARGIN = 0.25; // keeps the seated camera this far inside its zone (walls are 0.1 thick each side)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How quickly the camera swings behind a walking character (time constant). */
export const FOLLOW_TAU_MS = 450;
/** After the player drags the camera, auto-follow waits this long before taking over again. */
export const MANUAL_HOLD_MS = 1500;

/**
 * Eases the camera yaw toward "behind the character" (the camera sits at target + (sin yaw, cos yaw)·dist,
 * so behind a character facing `facing` is yaw = facing + π). Shortest arc, frame-rate independent.
 * `weight` (0..1) scales the pull; 0 leaves the yaw untouched.
 */
export function followYaw(yaw: number, facing: number, weight: number, dtMs: number, tauMs = FOLLOW_TAU_MS): number {
  if (weight <= 0 || dtMs <= 0) return yaw;
  const target = facing + Math.PI;
  const delta = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
  return yaw + delta * (1 - Math.exp(-dtMs / tauMs)) * Math.min(1, weight);
}

/**
 * Minimum follow-camera pitch in the study rooms. They are only 5 m deep, so at the default pitch the view ray hits
 * the 3 m walls and the boom pulls in to ~2.5 m (under 1 m near a wall), hiding the whiteboard and monitor. Looking
 * down more steeply lets the ray clear the walls from anywhere more than ~1.4 m away from them.
 */
export const STUDY_PITCH_FLOOR = 0.85;
/** The pitch floor eases in/out with this time constant when I walk into or out of a study room. */
export const PITCH_FLOOR_TAU_MS = 300;

/** The pitch floor for the zone I'm in: STUDY_PITCH_FLOOR in the study rooms, 0 (none) elsewhere. */
export function pitchFloorFor(zone: ZoneId | null): number {
  return zone === 'studyA' || zone === 'studyB' ? STUDY_PITCH_FLOOR : 0;
}

/** Ease the pitch floor toward `target` (exponential, frame-rate independent; dt ≤ 0 changes nothing). */
export function approachPitchFloor(cur: number, target: number, dtMs: number, tauMs = PITCH_FLOOR_TAU_MS): number {
  if (dtMs <= 0) return cur;
  return target + (cur - target) * Math.exp(-dtMs / tauMs);
}

const PULL_IN_TAU_MS = 50;   // a wall comes between me and the camera: get in front of it quickly
const EASE_OUT_TAU_MS = 400; // the wall is gone: drift back out gently instead of popping

/** Camera boom length easing: fast when it must shorten (occlusion), slow when it may lengthen again. */
export function approachDist(cur: number, target: number, dtMs: number): number {
  const tau = target < cur ? PULL_IN_TAU_MS : EASE_OUT_TAU_MS;
  return target + (cur - target) * Math.exp(-Math.max(0, dtMs) / tau);
}

/**
 * How much the current input should swing the camera: full for W, none for S (walking toward the camera)
 * or pure A/D (strafing would otherwise make the character circle), gentle for diagonals.
 */
export function forwardWeight(axis: { x: number; z: number }): number {
  const len = Math.hypot(axis.x, axis.z);
  if (len === 0) return 0;
  const f = Math.max(0, axis.z / len);
  return f * f;
}

/**
 * Seated view: behind (opposite facing) and above the seated avatar, looking over them at the desk.
 * Clamped into the seat's own zone so back-row desks and study-room chairs never put the camera in or behind a wall.
 */
export function seatedCameraPose(s: Seat): { pos: P3; look: P3 } {
  const fx = Math.sin(s.facing), fz = Math.cos(s.facing);
  const r = MAP.zones[s.zone], m = SEATED_WALL_MARGIN;
  return {
    pos: { x: clamp(s.x - fx * 1.9, r.x1 + m, r.x2 - m), y: 2.4, z: clamp(s.z - fz * 1.9, r.z1 + m, r.z2 - m) },
    look: { x: s.x + fx * 1.2, y: 0.7, z: s.z + fz * 1.2 },
  };
}

export class CameraRig {
  yaw = 0;
  pitch = 0.5;
  /** The view never looks down less steeply than this (the player's own pitch is kept; see updatePitchFloor). */
  pitchFloor = 0;
  dist = 5;
  private seat: Seat | null = null;
  private drag: { x: number; y: number } | null = null;
  private ray = new THREE.Raycaster();
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  // per-frame scratch (follow() allocates nothing)
  private desired = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private head = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private hits: THREE.Intersection[] = [];
  private pose: { seat: Seat; pos: P3; look: P3 } | null = null; // seatedCameraPose, cached per seat
  private inited = false;
  private manualHoldMs = 0; // auto-follow pauses while the player is steering the camera by hand
  private boom = -1;        // current (eased) camera distance along the view ray; -1 = not initialised
  private readonly cleanup: Array<() => void> = [];

  constructor(private cam: THREE.PerspectiveCamera, dom: HTMLElement) {
    const add = (t: EventTarget, ev: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn, opts);
      this.cleanup.push(() => t.removeEventListener(ev, fn));
    };
    add(dom, 'pointerdown', (e: PointerEvent) => { this.drag = { x: e.clientX, y: e.clientY }; });
    add(window, 'pointerup', () => { this.drag = null; });
    add(window, 'blur', () => { this.drag = null; });
    add(window, 'pointermove', (e: PointerEvent) => {
      if (!this.drag || this.seat) return;
      this.yaw -= (e.clientX - this.drag.x) * 0.005;
      this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + (e.clientY - this.drag.y) * 0.005));
      this.drag = { x: e.clientX, y: e.clientY };
      this.manualHoldMs = MANUAL_HOLD_MS;
    });
    add(dom, 'wheel', (e: WheelEvent) => {
      this.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, this.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: true });
  }

  setSeatedView(seat: Seat | null): void { this.seat = seat; }

  /** Ease pitchFloor toward the floor of the zone I'm in (pitchFloorFor). Call once per frame. */
  updatePitchFloor(zone: ZoneId | null, dtMs: number): void {
    this.pitchFloor = approachPitchFloor(this.pitchFloor, pitchFloorFor(zone), dtMs);
  }

  /**
   * Swing the camera behind the character while it walks forward. Call once per frame after movement with the
   * character's facing and `forwardWeight(input axis)` (0 when not moving). Paused while seated, while dragging,
   * and for MANUAL_HOLD_MS after a manual drag.
   */
  autoFollow(facing: number, weight: number, dtMs: number): void {
    if (this.manualHoldMs > 0) this.manualHoldMs = Math.max(0, this.manualHoldMs - dtMs);
    if (this.seat || this.drag || this.manualHoldMs > 0) return;
    this.yaw = followYaw(this.yaw, facing, weight, dtMs);
  }

  follow(target: THREE.Vector3, dtMs: number, occluders: THREE.Object3D[]): void {
    const { desired, lookAt, head, dir } = this;
    const s = this.seat;
    if (s) {
      if (this.pose?.seat !== s) this.pose = { seat: s, ...seatedCameraPose(s) };
      const pose = this.pose;
      desired.set(pose.pos.x, pose.pos.y, pose.pos.z);
      lookAt.set(pose.look.x, pose.look.y, pose.look.z);
    } else {
      head.set(target.x, target.y + HEAD_Y, target.z);
      const pitch = Math.max(this.pitch, this.pitchFloor);
      desired.set(
        head.x + Math.sin(this.yaw) * Math.cos(pitch) * this.dist,
        head.y + Math.sin(pitch) * this.dist,
        head.z + Math.cos(this.yaw) * Math.cos(pitch) * this.dist,
      );
      lookAt.copy(head);
      // occlusion: keep the camera in front of the first hit between the character and the camera.
      // The boom shortens quickly and lengthens slowly, so walking past door frames doesn't make the view pop.
      dir.copy(desired).sub(head);
      const full = dir.length();
      if (full > 1e-6) {
        dir.divideScalar(full);
        let allowed = full;
        if (occluders.length) {
          this.ray.set(head, dir);
          this.ray.camera = this.cam; this.ray.near = 0; this.ray.far = full;
          this.hits.length = 0;
          const hit = this.ray.intersectObjects(occluders, true, this.hits)[0];
          this.hits.length = 0;
          if (hit) allowed = Math.max(0.4, hit.distance - 0.2);
        }
        this.boom = this.boom < 0 ? allowed : Math.min(full, approachDist(this.boom, allowed, dtMs));
        desired.copy(head).addScaledVector(dir, this.boom);
      }
    }
    const k = this.inited ? 1 - Math.exp(-dtMs / SMOOTH_MS) : 1;
    this.inited = true;
    this.pos.lerp(desired, k);
    this.look.lerp(lookAt, k);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
  }

  dispose(): void { this.cleanup.forEach(f => f()); this.cleanup.length = 0; }
}

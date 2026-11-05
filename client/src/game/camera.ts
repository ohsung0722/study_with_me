// Third-person camera rig: drag to rotate, wheel to zoom, wall occlusion pull-in, seated view.
import * as THREE from 'three';
import type { Seat } from '@studyverse/shared';

const MIN_DIST = 2.5, MAX_DIST = 12;
const MIN_PITCH = 0.1, MAX_PITCH = 1.3;
const HEAD_Y = 1.4;
const SMOOTH_MS = 120;

export class CameraRig {
  yaw = 0;
  pitch = 0.5;
  dist = 5;
  private seat: Seat | null = null;
  private drag: { x: number; y: number } | null = null;
  private ray = new THREE.Raycaster();
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private inited = false;
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
    });
    add(dom, 'wheel', (e: WheelEvent) => {
      this.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, this.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: true });
  }

  setSeatedView(seat: Seat | null): void { this.seat = seat; }

  follow(target: THREE.Vector3, dtMs: number, occluders: THREE.Object3D[]): void {
    const desired = new THREE.Vector3();
    const lookAt = new THREE.Vector3();
    const s = this.seat;
    if (s) {
      // behind (opposite facing) and above the seated avatar, looking over them at the desk
      const fx = Math.sin(s.facing), fz = Math.cos(s.facing);
      desired.set(s.x - fx * 1.9, 2.4, s.z - fz * 1.9);
      lookAt.set(s.x + fx * 1.2, 0.7, s.z + fz * 1.2);
    } else {
      const head = new THREE.Vector3(target.x, target.y + HEAD_Y, target.z);
      desired.set(
        head.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist,
        head.y + Math.sin(this.pitch) * this.dist,
        head.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist,
      );
      lookAt.copy(head);
      // occlusion: pull the camera in front of the first hit between the character and the camera
      const dir = desired.clone().sub(head);
      const full = dir.length();
      if (full > 1e-6 && occluders.length) {
        this.ray.set(head, dir.divideScalar(full));
        this.ray.camera = this.cam; this.ray.near = 0; this.ray.far = full;
        const hit = this.ray.intersectObjects(occluders, true)[0];
        if (hit) {
          const d = Math.max(0.4, hit.distance - 0.2);
          desired.copy(head).addScaledVector(this.ray.ray.direction, d);
        }
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

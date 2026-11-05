// Rate-limited `move` sender: at most once per interval (TICK_HZ), only when the pose changed.
// Task 15 wires `send` to the socket. On a server `correct`, the caller sets the local position to the server's x/z.
import { TICK_HZ } from '@studyverse/shared';

type Pose = { x: number; z: number; ry: number };
const EPS = 1e-3;

export class MoveSender {
  private last: Pose | null = null;
  private lastAt = -Infinity;

  constructor(private send: (m: Pose) => void, private intervalMs = 1000 / TICK_HZ) {}

  private changed(p: Pose): boolean {
    const l = this.last;
    return !l || Math.abs(p.x - l.x) > EPS || Math.abs(p.z - l.z) > EPS || Math.abs(p.ry - l.ry) > EPS;
  }
  private emit(nowMs: number, p: Pose): void {
    this.last = { x: p.x, z: p.z, ry: p.ry };
    this.lastAt = nowMs;
    this.send({ x: p.x, z: p.z, ry: p.ry });
  }

  update(nowMs: number, pos: Pose): void {
    if (nowMs - this.lastAt < this.intervalMs) return;
    if (this.changed(pos)) this.emit(nowMs, pos);
  }

  /** Send immediately if the pose changed (e.g. right before stand/sit). */
  flush(nowMs: number, pos: Pose): void {
    if (this.changed(pos)) this.emit(nowMs, pos);
  }
}

// Local movement.
// Convention: input axis (x, z): W = forward = z +1, S = back, A = left = x -1, D = right = x +1.
// The input is rotated by the camera yaw so that W moves AWAY from the camera. The camera sits at
// target + (sin yaw, cos yaw) * dist, so forward = (-sin yaw, -cos yaw) and right = (cos yaw, -sin yaw).
// On a server `correct`, the caller sets the local position to the server's x/z. Sending: see moveSender.ts.
// Returned `ry` is the facing angle with the map's convention: forward = (sin ry, cos ry).
import { isBlocked, zoneAt, PLAYER_RADIUS, WALK_SPEED } from '@studyverse/shared';

/** Blocked by walls/props, or anywhere outside the building (e.g. through the entrance gap). */
export const MAX_STEP_SEC = 0.1;

export function walkBlocked(x: number, z: number): boolean {
  return isBlocked(x, z, PLAYER_RADIUS) || zoneAt(x, z) === null;
}

export function stepMovement(
  pos: { x: number; z: number }, dir: { x: number; z: number }, yaw: number, dtSec: number,
  blocked: (x: number, z: number) => boolean,
): { x: number; z: number; moving: boolean; ry: number } {
  const len = Math.hypot(dir.x, dir.z);
  dtSec = Math.min(dtSec, MAX_STEP_SEC); // a frame hitch must not tunnel through walls or exceed the server's per-move limit
  if (len === 0 || dtSec <= 0) return { x: pos.x, z: pos.z, moving: false, ry: 0 };
  const ix = dir.x / len, iz = dir.z / len;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const mx = -s * iz + c * ix;
  const mz = -c * iz - s * ix;
  const ry = Math.atan2(mx, mz);
  const step = WALK_SPEED * dtSec;
  const nx = pos.x + mx * step, nz = pos.z + mz * step;
  if (!blocked(nx, nz)) return { x: nx, z: nz, moving: true, ry };
  // slide: resolve each axis separately
  let x = pos.x, z = pos.z;
  if (!blocked(nx, z)) x = nx;
  if (!blocked(x, nz)) z = nz;
  return { x, z, moving: x !== pos.x || z !== pos.z, ry };
}

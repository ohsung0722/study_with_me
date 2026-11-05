// Where a seated avatar puts its cup: on the desk/table in front of it, if there is one (sofas → none).
import { MAP } from '@studyverse/shared';

export const CUP_FORWARD = 0.55;   // desk/table edges are 0.45 m in front of the seat point
const LATERAL = [-0.18, 0.18, -0.36, 0.36, 0]; // avatar-space x; -x is the avatar's right (it faces +z)
const MARGIN = 0.06;               // keep the whole cup on the top

/**
 * Avatar-local (x, z) spot for the cup, or null when nothing to put it on. `ry` follows the map's facing
 * convention (forward = (sin ry, cos ry)); local (lx, lz) maps to world (lx·cos ry + lz·sin ry, −lx·sin ry + lz·cos ry).
 */
export function deskCupSpot(x: number, z: number, ry: number): { x: number; z: number } | null {
  const c = Math.cos(ry), s = Math.sin(ry);
  for (const lx of LATERAL) {
    const wx = x + lx * c + CUP_FORWARD * s;
    const wz = z - lx * s + CUP_FORWARD * c;
    const onTop = MAP.props.some(p => (p.kind === 'desk' || p.kind === 'table')
      && wx >= p.x1 + MARGIN && wx <= p.x2 - MARGIN && wz >= p.z1 + MARGIN && wz <= p.z2 - MARGIN);
    if (onTop) return { x: lx, z: CUP_FORWARD };
  }
  return null;
}

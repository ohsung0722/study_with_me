// Snapshot interpolation for other players. Render time = serverNow - INTERP_DELAY_MS.
export const INTERP_DELAY_MS = 100;
interface Snap { t: number; x: number; z: number; ry: number }

const TWO_PI = Math.PI * 2;
function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI; else if (d < -Math.PI) d += TWO_PI;
  return a + d * k;
}

export class Interpolator {
  private snaps: Snap[] = [];

  reset(): void { this.snaps = []; }

  push(serverT: number, s: { x: number; z: number; ry: number }): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && serverT <= last.t) return; // drop stale/duplicate
    this.snaps.push({ t: serverT, x: s.x, z: s.z, ry: s.ry });
    if (this.snaps.length > 20) this.snaps.shift();
  }

  sample(serverNow: number): { x: number; z: number; ry: number } | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    const rt = serverNow - INTERP_DELAY_MS;
    const first = this.snaps[0], last = this.snaps[n - 1];
    if (rt <= first.t) return { x: first.x, z: first.z, ry: first.ry };
    if (rt >= last.t) return { x: last.x, z: last.z, ry: last.ry };
    for (let i = 1; i < n; i++) {
      const b = this.snaps[i];
      if (rt <= b.t) {
        const a = this.snaps[i - 1];
        const k = (rt - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, ry: lerpAngle(a.ry, b.ry, k) };
      }
    }
    return { x: last.x, z: last.z, ry: last.ry };
  }
}

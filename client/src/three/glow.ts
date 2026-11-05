// Fake lamp light: a soft warm pool on the surface under each lamp (desk top, table, floor). Each pool is a flat
// quad with a shared radial-gradient texture, drawn additively without writing depth. All quads of a zone share one
// mesh (one draw call per zone). A quad's colour is lamp colour × (surface colour × diffuse + sheen): the diffuse
// light a real lamp would add to that surface plus the soft specular sheen it used to leave on dark matte surfaces.
// It lives in the vertex colours, so a level change only rewrites a small buffer.
import * as THREE from 'three';
import type { Rect, ZoneId } from '@studyverse/shared';

/** A horizontal quad (x/z extents) with the UVs that keep the gradient centred on the lamp. */
export interface GlowQuad { x1: number; z1: number; x2: number; z2: number; u1: number; v1: number; u2: number; v2: number }

/** The light pool of a lamp at (cx, cz) with radius r, clipped to the surface `clip`; null if they don't overlap. */
export function glowQuad(cx: number, cz: number, r: number, clip: Rect): GlowQuad | null {
  const x1 = Math.max(cx - r, clip.x1), x2 = Math.min(cx + r, clip.x2);
  const z1 = Math.max(cz - r, clip.z1), z2 = Math.min(cz + r, clip.z2);
  if (x2 <= x1 || z2 <= z1) return null;
  const u = (x: number) => (x - (cx - r)) / (2 * r), v = (z: number) => (z - (cz - r)) / (2 * r);
  return { x1, z1, x2, z2, u1: u(x1), v1: v(z1), u2: u(x2), v2: v(z2) };
}

/** Gradient profile at normalised radius t (0 centre, 1 rim): bright core, long soft tail, 0 at the rim. */
export function glowFalloff(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  const w = 1 - t * t;
  return w * w * (0.35 + 0.65 / (1 + 12 * t * t));
}

let sharedTexture: THREE.Texture | null = null;

/** The shared radial gradient (white, linear values; edges are black so clamping leaves nothing outside the rim). */
export function glowTexture(): THREE.Texture {
  if (sharedTexture) return sharedTexture;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) {
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
        const v = Math.round(255 * glowFalloff(Math.hypot(dx, dy)));
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  sharedTexture = tex;
  return tex;
}

interface Pending { zone: ZoneId; q: GlowQuad; y: number }
const WHITE = new THREE.Color(1, 1, 1);

export class GlowLayer {
  private pending: Pending[] = [];
  private where: { mesh: number; offset: number }[] = []; // glow id → mesh index + first vertex
  private meshes: THREE.Mesh[] = [];
  private colors: THREE.BufferAttribute[] = [];
  private levels: number[] = [];   // diffuse level per glow id
  private sheens: number[] = [];   // sheen level per glow id
  private tints: THREE.Color[] = [];                    // per glow id: its surface colour (shared per surface)
  private surfaces = new Map<string, THREE.Color>();
  private color = new THREE.Color(1, 1, 1);
  private dirty: boolean[] = []; // per mesh: colours changed since the last flush

  constructor(private parent: THREE.Object3D, private texture: THREE.Texture) {}

  /** Register a quad at height y on `surface` (see setSurface); returns its id. Call build() after the last add(). */
  add(zone: ZoneId, q: GlowQuad, y: number, surface?: string): number {
    this.pending.push({ zone, q, y });
    this.levels.push(0);
    this.sheens.push(0);
    let tint = WHITE;
    if (surface !== undefined) {
      tint = this.surfaces.get(surface) ?? new THREE.Color(1, 1, 1);
      this.surfaces.set(surface, tint);
    }
    this.tints.push(tint);
    return this.pending.length - 1;
  }

  /** Surface colour (albedo, sRGB hex × scale) the pools on `surface` are tinted with. */
  setSurface(surface: string, hex: number, scale = 1): void {
    const c = this.surfaces.get(surface);
    if (!c) return;
    c.setHex(hex).multiplyScalar(scale);
    for (let id = 0; id < this.tints.length; id++) if (this.tints[id] === c) this.write(id);
  }

  build(): void {
    const byZone = new Map<ZoneId, number[]>();
    this.pending.forEach((p, id) => {
      let ids = byZone.get(p.zone);
      if (!ids) byZone.set(p.zone, (ids = []));
      ids.push(id);
    });
    this.where = new Array(this.pending.length);
    for (const [zone, ids] of byZone) {
      const pos = new Float32Array(ids.length * 12), uv = new Float32Array(ids.length * 8), idx: number[] = [];
      ids.forEach((id, k) => {
        const { q, y } = this.pending[id];
        pos.set([q.x1, y, q.z1, q.x2, y, q.z1, q.x2, y, q.z2, q.x1, y, q.z2], k * 12);
        uv.set([q.u1, q.v1, q.u2, q.v1, q.u2, q.v2, q.u1, q.v2], k * 8);
        const b = k * 4;
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2); // counter-clockwise seen from above (+y)
        this.where[id] = { mesh: this.meshes.length, offset: b };
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const col = new THREE.BufferAttribute(new Float32Array(ids.length * 12), 3);
      col.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('color', col);
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mat = new THREE.MeshBasicMaterial({
        map: this.texture, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `glow:${zone}`;
      mesh.renderOrder = 2;
      this.parent.add(mesh);
      this.meshes.push(mesh);
      this.colors.push(col);
    }
    this.dirty = this.meshes.map(() => false);
    this.pending = [];
  }

  /** Lamp colour of every pool (sRGB hex, as the lamp lights use). */
  setColor(hex: number): void {
    this.color.setHex(hex);
    for (let id = 0; id < this.levels.length; id++) this.write(id);
  }

  /**
   * Strength of one pool: `diffuse` = lamp irradiance at its centre (light intensity units / π; × surface colour),
   * `sheen` = untinted extra (the specular sheen); 0 = off.
   */
  set(id: number, diffuse: number, sheen = 0): void {
    const d = Math.max(0, diffuse), s = Math.max(0, sheen);
    if (Math.abs(d - this.levels[id]) < 1e-4 && Math.abs(s - this.sheens[id]) < 1e-4) return;
    this.levels[id] = d;
    this.sheens[id] = s;
    this.write(id);
  }

  /** Upload changed colours (call once per frame after the set() calls). */
  flush(): void {
    for (let m = 0; m < this.dirty.length; m++) {
      if (!this.dirty[m]) continue;
      this.colors[m].needsUpdate = true;
      this.dirty[m] = false;
    }
  }

  private write(id: number): void {
    const w = this.where[id];
    if (!w) return;
    const c = this.color, t = this.tints[id], l = this.levels[id], sh = this.sheens[id];
    const arr = this.colors[w.mesh].array as Float32Array;
    const r = c.r * (t.r * l + sh), g = c.g * (t.g * l + sh), b = c.b * (t.b * l + sh);
    for (let k = 0; k < 4; k++) {
      const i = (w.offset + k) * 3;
      arr[i] = r;
      arr[i + 1] = g;
      arr[i + 2] = b;
    }
    this.dirty[w.mesh] = true;
  }
}

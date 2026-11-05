// A fixed pool of real PointLights shared by all lamps. Forward shading pays for every light on every lit fragment,
// so instead of one light per lamp (up to 31) only the LIGHT_POOL_SIZE lamps that matter most at the focus point
// (my avatar) get a real light; every other lamp is drawn with a fake glow (glow.ts). The lights are created once
// and never hidden — unused slots sit at intensity 0 — so the shader's light count never changes (no recompiles).
import * as THREE from 'three';

export const LIGHT_POOL_SIZE = 6;
export const POOL_PICK_MS = 150;  // how often the lamps are re-picked
export const POOL_FADE_MS = 250;  // a slot's intensity settles over about this long
const FADE_TAU_MS = POOL_FADE_MS / 3; // exponential easing: ~95 % after POOL_FADE_MS
const DARK = 0.02;                // below this a fading slot counts as off (and may jump to its next lamp)

/** A lamp that can borrow a pool light. `intensity` is its current light intensity (theme × zone dim); 0 = off. */
export interface LampSource {
  x: number; y: number; z: number;
  distance: number; decay: number;
  intensity: number;
}

/** src: lamp the light sits at (-1 none); next: lamp it should serve (-1 none); intensity: current, eased. */
export interface PoolSlot { src: number; next: number; intensity: number }

/** Contribution of a lamp at the focus point: intensity (already × zone dim) / (1 + distance²), in the floor plane. */
export function lampScore(s: LampSource, fx: number, fz: number): number {
  if (!(s.intensity > 0)) return 0;
  const dx = s.x - fx, dz = s.z - fz;
  return s.intensity / (1 + dx * dx + dz * dz);
}

const topScores: number[] = [];

/** Indices of the (up to) n highest-scoring lit lamps, best first; ties go to the lower index. Fills and returns `out`. */
export function selectLamps(sources: readonly LampSource[], fx: number, fz: number, n: number, out: number[] = []): number[] {
  out.length = 0;
  topScores.length = 0;
  for (let i = 0; i < sources.length; i++) {
    const sc = lampScore(sources[i], fx, fz);
    if (sc <= 0) continue;
    let k: number;
    if (out.length < n) { k = out.length; out.push(i); topScores.push(sc); }
    else if (sc > topScores[n - 1]) { k = n - 1; out[k] = i; topScores[k] = sc; }
    else continue;
    while (k > 0 && topScores[k - 1] < sc) { // bubble up; equal scores keep the lower index first
      out[k] = out[k - 1]; topScores[k] = topScores[k - 1];
      out[k - 1] = i; topScores[k - 1] = sc;
      k--;
    }
  }
  return out;
}

function slotFor(slots: readonly PoolSlot[], lamp: number): number {
  for (let i = 0; i < slots.length; i++) if (slots[i].next === lamp) return i;
  return -1;
}

/**
 * Point each slot's `next` at a picked lamp. Slots already serving a picked lamp keep it; slots whose lamp was
 * dropped are freed; newly picked lamps go to the free slot already sitting on them (no jump), else the darkest one.
 */
export function assignSlots(slots: PoolSlot[], picked: readonly number[]): void {
  for (const s of slots) if (s.next >= 0 && picked.indexOf(s.next) < 0) s.next = -1;
  for (const p of picked) {
    if (slotFor(slots, p) >= 0) continue;
    let best = -1;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.next !== -1) continue;
      if (s.src === p) { best = i; break; }
      if (best < 0 || s.intensity < slots[best].intensity) best = i;
    }
    if (best >= 0) slots[best].next = p;
  }
}

/** The pool's state machine, independent of three.js. */
export class LightPoolState {
  readonly slots: PoolSlot[];
  private sincePick = Infinity;
  private picked: number[] = [];

  constructor(readonly size = LIGHT_POOL_SIZE) {
    this.slots = Array.from({ length: size }, () => ({ src: -1, next: -1, intensity: 0 }));
  }

  /** Re-pick every POOL_PICK_MS; ease every slot toward its lamp's intensity (or to 0 before moving to a new lamp). */
  update(sources: readonly LampSource[], fx: number, fz: number, dtMs: number): void {
    this.sincePick += dtMs;
    if (this.sincePick >= POOL_PICK_MS) {
      this.sincePick = 0;
      assignSlots(this.slots, selectLamps(sources, fx, fz, this.size, this.picked));
    }
    const k = 1 - Math.exp(-Math.max(0, dtMs) / FADE_TAU_MS);
    for (const s of this.slots) {
      if (s.src !== s.next && s.intensity < DARK) { s.src = s.next; s.intensity = 0; } // jump only while dark
      const target = s.src >= 0 && s.src === s.next ? sources[s.src]?.intensity ?? 0 : 0;
      s.intensity += (target - s.intensity) * k;
      if (target === 0 && s.intensity < DARK) s.intensity = 0;
      if (s.src !== s.next && s.intensity === 0) s.src = s.next;
    }
  }

  /** Fraction (0..1) of lamp i's light currently carried by a pool light; the fake glow draws the rest. */
  share(i: number, sources: readonly LampSource[]): number {
    const full = sources[i]?.intensity ?? 0;
    if (!(full > 0)) return 0;
    for (const s of this.slots) if (s.src === i) return Math.min(1, s.intensity / full);
    return 0;
  }

  /** Slots currently giving light. */
  active(): number {
    let n = 0;
    for (const s of this.slots) if (s.intensity > 0) n++;
    return n;
  }
}

/** LightPoolState bound to LIGHT_POOL_SIZE real PointLights (created once, always visible, no shadows). */
export class LightPool {
  readonly state: LightPoolState;
  readonly lights: THREE.PointLight[];

  constructor(parent: THREE.Object3D, size = LIGHT_POOL_SIZE) {
    this.state = new LightPoolState(size);
    this.lights = this.state.slots.map((_, i) => {
      const l = new THREE.PointLight(0xffffff, 0);
      l.name = `lampPool:${i}`;
      parent.add(l);
      return l;
    });
  }

  setColor(hex: number): void {
    for (const l of this.lights) l.color.setHex(hex);
  }

  update(sources: readonly LampSource[], fx: number, fz: number, dtMs: number): void {
    this.state.update(sources, fx, fz, dtMs);
    const slots = this.state.slots;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i], l = this.lights[i];
      l.intensity = s.intensity;
      const src = s.src >= 0 ? sources[s.src] : undefined;
      if (!src) continue;
      l.position.set(src.x, src.y, src.z);
      l.distance = src.distance;
      l.decay = src.decay;
    }
  }

  share(i: number, sources: readonly LampSource[]): number {
    return this.state.share(i, sources);
  }

  active(): number {
    return this.state.active();
  }
}

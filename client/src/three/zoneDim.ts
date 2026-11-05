// Per-zone dimming: the zone I'm in stays at full brightness, other zones fade to OTHER_ZONE_BRIGHTNESS.
// In a corridor or hall (or outside) everything is at 1. Materials keep a base colour; colour = base × factor.
import * as THREE from 'three';
import { MAP, OTHER_ZONE_BRIGHTNESS, ZONE_FADE_MS, zoneKind, type ZoneId } from '@studyverse/shared';

export const ZONE_IDS = Object.keys(MAP.zones) as readonly ZoneId[];

export function zoneTargets(current: ZoneId | null): Record<ZoneId, number> {
  const all = current === null || zoneKind(current) === 'corridor';
  const out = {} as Record<ZoneId, number>;
  for (const z of ZONE_IDS) out[z] = all || z === current ? 1 : OTHER_ZONE_BRIGHTNESS;
  return out;
}

/** Anything with a colour that can be scaled (lambert, standard or basic materials). */
export type DimmableMaterial = THREE.MeshLambertMaterial | THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;

interface Entry { m: DimmableMaterial; zone: ZoneId; base: THREE.Color }

// Full swing 1 → OTHER_ZONE_BRIGHTNESS takes exactly ZONE_FADE_MS.
const RATE_PER_MS = (1 - OTHER_ZONE_BRIGHTNESS) / ZONE_FADE_MS;

export class ZoneDimmer {
  private cur = zoneTargets(null);
  private target = zoneTargets(null);
  private entries: Entry[] = [];
  private byMat = new Map<DimmableMaterial, Entry>();

  /** Track a material; its current colour becomes the base colour. */
  register(zone: ZoneId, m: DimmableMaterial): void {
    const e: Entry = { m, zone, base: m.color.clone() };
    this.entries.push(e);
    this.byMat.set(m, e);
    this.paint(e);
  }

  /** Change a registered material's base colour (e.g. on a theme change); the current factor still applies. */
  setBase(m: DimmableMaterial, color: THREE.ColorRepresentation, scale = 1): void {
    const e = this.byMat.get(m);
    if (!e) return;
    e.base.set(color).multiplyScalar(scale);
    this.paint(e);
  }

  setZone(z: ZoneId | null): void {
    this.target = zoneTargets(z);
  }

  update(dtMs: number): void {
    const step = RATE_PER_MS * Math.max(0, dtMs);
    let changed = false;
    for (const z of ZONE_IDS) {
      const d = this.target[z] - this.cur[z];
      if (d === 0) continue;
      this.cur[z] = Math.abs(d) <= step + 1e-9 ? this.target[z] : this.cur[z] + Math.sign(d) * step;
      changed = true;
    }
    if (changed) for (const e of this.entries) this.paint(e);
  }

  factor(z: ZoneId): number {
    return this.cur[z];
  }

  private paint(e: Entry): void {
    e.m.color.copy(e.base).multiplyScalar(this.cur[e.zone]);
  }
}

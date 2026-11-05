// Room signs (client-only): a frosted film with the room's name on the glass hall wall of every study room and lounge,
// and double-sided wooden signs hanging over the main corridor that point the way to the rooms on either side. Text is
// drawn onto canvas textures (left blank where there is no 2D canvas, e.g. jsdom).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP, type ZoneId } from '@studyverse/shared';
import type { ZoneDimmer } from './zoneDim';

const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

/** Rooms that get a film on their glass hall wall: Korean name, English name. */
const ROOM_NAMES: Partial<Record<ZoneId, [string, string]>> = {
  studyA: ['스터디룸 A', 'STUDY ROOM A'], studyB: ['스터디룸 B', 'STUDY ROOM B'],
  studyC: ['스터디룸 C', 'STUDY ROOM C'], studyD: ['스터디룸 D', 'STUDY ROOM D'],
  lounge: ['라운지', 'LOUNGE'], cafe: ['카페', 'CAFE'],
};

const FILM_W = 3.0, FILM_H = 0.62, FILM_Y = 1.45; // film panel size and centre height on the glass
const FILM_OFF = 0.012;                            // in front of the glass face (no z-fighting)
const SIGN_W = 3.6, SIGN_H = 0.42, SIGN_D = 0.05;  // hanging sign board
const SIGN_Y = 2.55;                               // board centre height (walls are 3 m)
const WOOD = 0x7a5236;

// Emissive share that keeps the text readable when the corridor is lamp-lit at night (× night 0..1, plus a day base).
const GLOW_DAY = 0.12, GLOW_NIGHT = 0.45;

export interface Signs {
  /** 0 by day … 1 by night (the theme's rain level). */
  setNight(n: number): void;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4; // read at a slant from the follow camera
  return tex;
}

/** Frosted film: a soft white band with the Korean name large and the English name small, in dark ink. */
function filmTexture(ko: string, en: string): THREE.CanvasTexture {
  return canvasTexture(768, 160, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.78)';
    g.beginPath();
    g.roundRect(4, 4, 760, 152, 18);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#2b2622';
    g.font = `bold 68px ${FONT}`;
    g.fillText(ko, 384, 66);
    g.fillStyle = '#5a5149';
    g.font = `600 28px ${FONT}`;
    g.fillText(en.split('').join(' '), 384, 126); // a little letter-spacing
  });
}

/** One face of a hanging sign: "← left      right →" in cream on wood. */
function hangTexture(left: string, right: string): THREE.CanvasTexture {
  return canvasTexture(1024, 120, (g) => {
    g.fillStyle = '#7a5236';
    g.fillRect(0, 0, 1024, 120);
    g.strokeStyle = 'rgba(255,240,215,0.35)';
    g.lineWidth = 4;
    g.strokeRect(10, 10, 1004, 100);
    g.fillStyle = '#fbefd9';
    g.font = `bold 52px ${FONT}`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(`←  ${left}`, 40, 62);
    g.textAlign = 'right';
    g.fillText(`${right}  →`, 984, 62);
  });
}

function signMaterial(map: THREE.Texture, transparent: boolean): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: GLOW_DAY,
    transparent, depthWrite: !transparent, side: transparent ? THREE.DoubleSide : THREE.FrontSide,
  });
}

/** Builds the films and the hanging signs under `root`; materials are dimmed with the zone they belong to. */
export function buildSigns(root: THREE.Object3D, dim: ZoneDimmer): Signs {
  const mats: THREE.MeshLambertMaterial[] = [];
  const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.MeshLambertMaterial, zone: ZoneId) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    root.add(mesh);
    dim.register(zone, mat);
    mats.push(mat);
    return mesh;
  };

  // ---------- films: on the hall face of each room's glass hall wall, centred on its longest glass stretch ----------
  for (const [zone, [ko, en]] of Object.entries(ROOM_NAMES) as [ZoneId, [string, string]][]) {
    const r = MAP.zones[zone];
    const hallIsSouth = MAP.zones.hallW.z1 >= r.z2 - 1e-9; // study rooms: hall to the south; lounges: to the north
    const wz = hallIsSouth ? r.z2 : r.z1;
    let best: { a: number; b: number } | null = null;
    for (const w of MAP.walls) {
      if (!w.glass || !(w.z1 < wz && w.z2 > wz) || w.x2 - w.x1 < w.z2 - w.z1) continue;
      const a = Math.max(w.x1, r.x1), b = Math.min(w.x2, r.x2);
      if (b - a > (best ? best.b - best.a : 0)) best = { a, b };
    }
    if (!best) continue;
    const n = hallIsSouth ? 1 : -1; // towards the hall
    const geo = new THREE.PlaneGeometry(Math.min(FILM_W, best.b - best.a - 0.3), FILM_H);
    if (n < 0) geo.rotateY(Math.PI);
    geo.translate((best.a + best.b) / 2, FILM_Y, wz + n * (0.1 + FILM_OFF));
    add(`sign:film:${zone}`, geo, signMaterial(filmTexture(ko, en), true), zone);
  }

  // ---------- hanging signs over the main corridor, facing along it ----------
  // Walking in (toward -z) the west wing is on the left; walking out it is on the right, so the back face swaps sides.
  const c = MAP.zones.corridor, cx = (c.x1 + c.x2) / 2, lz = MAP.zones.lounge.z1;
  const HANGING: { z: number; west: string; east: string }[] = [
    { z: 11, west: '열람실 A', east: '열람실 B' },                                  // at the reading-room doors
    { z: (MAP.zones.hallW.z1 + lz) / 2, west: '스터디룸 A · B', east: '스터디룸 C · D' }, // where the halls open
    { z: lz + 6, west: '라운지', east: '카페' },                                     // at the lounge doors
  ];
  const boards: THREE.BufferGeometry[] = [];
  HANGING.forEach((h, i) => {
    boards.push(new THREE.BoxGeometry(SIGN_W, SIGN_H, SIGN_D).translate(cx, SIGN_Y, h.z));
    for (const sx of [-1, 1]) {
      const top = MAP.wallHeight, bottom = SIGN_Y + SIGN_H / 2;
      boards.push(new THREE.CylinderGeometry(0.008, 0.008, top - bottom, 6).translate(cx + sx * (SIGN_W / 2 - 0.25), (top + bottom) / 2, h.z));
    }
    const face = (left: string, right: string, n: 1 | -1) => {
      const geo = new THREE.PlaneGeometry(SIGN_W - 0.08, SIGN_H - 0.06);
      if (n < 0) geo.rotateY(Math.PI);
      return geo.translate(cx, SIGN_Y, h.z + n * (SIGN_D / 2 + 0.002));
    };
    add(`sign:hang:${i}:in`, face(h.west, h.east, 1), signMaterial(hangTexture(h.west, h.east), false), 'corridor');
    add(`sign:hang:${i}:out`, face(h.east, h.west, -1), signMaterial(hangTexture(h.east, h.west), false), 'corridor');
  });
  // boards and their hanging rods: one merged wood mesh
  const woodMat = new THREE.MeshLambertMaterial({ color: WOOD });
  const wood = new THREE.Mesh(mergeGeometries(boards.map(b => b.toNonIndexed())), woodMat);
  boards.forEach(b => b.dispose());
  wood.name = 'signBoards';
  wood.castShadow = true;
  root.add(wood);
  dim.register('corridor', woodMat);

  return {
    setNight(n: number) {
      for (const m of mats) m.emissiveIntensity = GLOW_DAY + (GLOW_NIGHT - GLOW_DAY) * n;
    },
  };
}

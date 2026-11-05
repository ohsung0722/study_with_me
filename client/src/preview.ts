// Dev-only 3D preview (served by Vite at /preview.html; not part of the production build or the game path).
// Renders the building with a few avatars so the look can be checked without the server.
import * as THREE from 'three';
import { MAP, seatById, zoneAt, type Appearance, type PlayerView, type Status, type ZoneId } from '@studyverse/shared';
import { createScene } from './three/scene';
import { buildBuilding } from './three/building';
import { DAY, NIGHT, ThemeBlender } from './three/theme';
import { ZoneDimmer } from './three/zoneDim';
import { createAvatar, type AvatarRig } from './three/avatar';
import { LabelSprite, labelText } from './three/label';

const view = document.getElementById('view')!;
const help = document.getElementById('help')!;
const ctx = createScene(view);
const dimmer = new ZoneDimmer();
const building = buildBuilding(ctx.scene, dimmer);
const blender = new ThemeBlender(DAY);
const applyTheme = () => {
  ctx.applyTheme(blender.current());
  building.applyTheme(blender.current());
};
applyTheme();

interface Actor { rig: AvatarRig; label: LabelSprite; view: PlayerView; isMe?: boolean; tick?: (t: number) => void }
const now = Date.now();
const look = (hair: Appearance['hair'], hairColor: string, shirtColor: string): Appearance => ({ hair, hairColor, shirtColor });
const actors: Actor[] = [];

function addActor(v: Omit<PlayerView, 'id' | 'zone' | 'ry' | 'drink'> & { drink?: PlayerView['drink'] }, opts: { isMe?: boolean; tick?: (t: number) => void } = {}) {
  const view: PlayerView = { id: `p${actors.length}`, zone: zoneAt(v.x, v.z), ry: 0, drink: null, ...v };
  const rig = createAvatar(v.appearance);
  const label = new LabelSprite();
  label.object.position.y = 2.0;
  rig.root.add(label.object);
  rig.root.position.set(v.x, 0, v.z);
  if (v.seatId) {
    const seat = seatById(v.seatId)!;
    rig.root.position.set(seat.x, 0, seat.z);
    rig.root.rotation.y = seat.facing;
    rig.setPose('sit');
  }
  rig.setDrink(view.drink?.id ?? null);
  ctx.scene.add(rig.root);
  const a: Actor = { rig, label, view, ...opts };
  actors.push(a);
  return a;
}

const studying = (minAgo: number, focus: boolean): Status => ({ kind: 'studying', startedAt: now - minAgo * 60_000, focus });
const seatPos = (id: string) => ({ x: seatById(id)!.x, z: seatById(id)!.z });

// 1) "me", walking a loop in the lounge
const walker = addActor({ nickname: '나민수', appearance: look('short', '#4a2e1a', '#4fc3f7'), isNpc: false, x: 6.5, z: 18.5,
  seatId: null, status: { kind: 'none' } }, { isMe: true });
walker.rig.setPose('walk');
walker.tick = (t) => {
  const a = t * 0.6, x = 6.5 + Math.cos(a) * 3.5, z = 18.5 + Math.sin(a) * 2.2;
  const dx = -Math.sin(a) * 3.5, dz = Math.cos(a) * 2.2; // velocity direction
  walker.rig.root.position.set(x, 0, z);
  walker.rig.root.rotation.y = Math.atan2(dx, dz); // forward = (sin ry, cos ry)
  walker.view.x = x; walker.view.z = z;
};
// 2) seated, focus-mode studying in the reading room
addActor({ nickname: '지우', appearance: look('long', '#3b2a1e', '#81c784'), isNpc: false, ...seatPos('R08'), seatId: 'R08',
  status: studying(134, true) });
addActor({ nickname: '메이트', appearance: look('bun', '#1f1f1f', '#b39ddb'), isNpc: true, ...seatPos('R03'), seatId: 'R03',
  status: studying(47, true) });
addActor({ nickname: '하늘', appearance: look('short', '#6b3b1f', '#ffd54f'), isNpc: false, ...seatPos('R15'), seatId: 'R15',
  status: studying(12, false) });
// 3) study room, on a break, with a drink
addActor({ nickname: '도윤', appearance: look('bun', '#2a1a10', '#f48fb1'), isNpc: false, ...seatPos('A2'), seatId: 'A2',
  status: { kind: 'break', endsAt: now + 9 * 60_000 }, drink: { id: 'latte', until: now + 600_000 } });
// 4) lounge sofa with an americano
addActor({ nickname: '서연', appearance: look('long', '#6b3b1f', '#90caf9'), isNpc: false, ...seatPos('S2'), seatId: 'S2',
  status: { kind: 'none' }, drink: { id: 'americano', until: now + 600_000 } });
// 5) waving in the corridor, holding a green tea
const waver = addActor({ nickname: '유나', appearance: look('bun', '#4a2e1a', '#ff8a65'), isNpc: false, x: 14.5, z: 12,
  seatId: null, status: { kind: 'none' }, drink: { id: 'greenTea', until: now + 600_000 } });
waver.rig.root.rotation.y = -Math.PI / 2;
let nextWave = 0;
waver.tick = (t) => { if (t > nextWave) { waver.rig.wave(); nextWave = t + 3.5; } };

// ---------- simple orbit camera ----------
const target = new THREE.Vector3(MAP.width / 2, 0.8, MAP.depth / 2);
const want = target.clone();
let yaw = 0, pitch = 0.95, dist = 34;
let drag: { x: number; y: number } | null = null;
ctx.renderer.domElement.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('pointermove', e => {
  if (!drag) return;
  yaw -= (e.clientX - drag.x) * 0.005;
  pitch = Math.min(1.45, Math.max(0.2, pitch + (e.clientY - drag.y) * 0.005));
  drag = { x: e.clientX, y: e.clientY };
});
ctx.renderer.domElement.addEventListener('wheel', e => { dist = Math.min(60, Math.max(4, dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });

// ---------- keys: 1/2 theme, 3-7 zone, 0 none ----------
const ZONE_KEYS: Record<string, ZoneId> = { Digit3: 'lounge', Digit4: 'corridor', Digit5: 'reading', Digit6: 'studyA', Digit7: 'studyB' };
const ZONE_KO: Record<ZoneId, string> = { lounge: '라운지', corridor: '복도', reading: '열람실', studyA: '스터디룸 A', studyB: '스터디룸 B' };
let curZone: ZoneId | null = null;
let themeName = '낮';
let follow = false;
const updateHelp = () => {
  help.textContent = `개발용 3D 미리보기 — 테마: ${themeName} · 현재 구역: ${curZone ?? '없음(전체 밝게)'}\n`
    + '1 낮 · 2 밤 · 3 라운지 · 4 복도 · 5 열람실 · 6 스터디룸 A · 7 스터디룸 B · 0 구역 없음\n드래그 회전 · 휠 확대/축소';
};
updateHelp();
window.addEventListener('keydown', e => {
  if (e.code === 'KeyF') {
    follow = !follow;
    dist = follow ? 5 : 18;
    pitch = follow ? 0.45 : 0.95;
    return;
  }
  if (e.code === 'Digit1') { blender.setTarget(DAY); themeName = '낮'; }
  else if (e.code === 'Digit2') { blender.setTarget(NIGHT); themeName = '밤'; }
  else if (e.code === 'Digit0') { curZone = null; want.set(MAP.width / 2, 0.8, MAP.depth / 2); dist = 34; }
  else if (ZONE_KEYS[e.code]) {
    curZone = ZONE_KEYS[e.code];
    const r = MAP.zones[curZone];
    want.set((r.x1 + r.x2) / 2, 0.8, (r.z1 + r.z2) / 2);
    dist = 18;
  } else return;
  dimmer.setZone(curZone);
  updateHelp();
});

// ---------- frame ----------
let elapsed = 0;
ctx.onFrame((dtMs) => {
  elapsed += dtMs / 1000;
  if (blender.update(dtMs)) applyTheme();
  dimmer.update(dtMs);
  building.update(dtMs);

  const serverNow = Date.now();
  for (const a of actors) {
    a.tick?.(elapsed);
    a.rig.update(dtMs);
    const z = zoneAt(a.rig.root.position.x, a.rig.root.position.z);
    const f = z ? dimmer.factor(z) : 1;
    a.rig.setDim(f);
    const { text, style } = labelText(a.view, serverNow, a.isMe);
    a.label.set(text, style);
    a.label.setOpacity(0.55 + 0.45 * f);
  }

  if (follow) want.set(walker.rig.root.position.x, 1.0, walker.rig.root.position.z);
  target.lerp(want, Math.min(1, dtMs / 250));
  const cam = ctx.camera;
  cam.position.set(
    target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    target.y + Math.sin(pitch) * dist,
    target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  cam.lookAt(target);
});
ctx.start();

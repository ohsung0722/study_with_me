// Dev-only 3D preview (served by Vite at /preview.html; not part of the production build or the game path).
// Renders the building with a few avatars so the look can be checked without the server.
import * as THREE from 'three';
import { MAP, seatById, zoneAt, type Seat, type Appearance, type PlayerView, type Status, type ZoneId } from '@studyverse/shared';
import { createScene } from './three/scene';
import { buildBuilding } from './three/building';
import { DAY, NIGHT, ThemeBlender } from './three/theme';
import { ZoneDimmer } from './three/zoneDim';
import { createAvatar, type AvatarRig } from './three/avatar';
import { LabelSprite, labelText } from './three/label';
import { InputState } from './game/input';
import { stepMovement, walkBlocked } from './game/controller';
import { CameraRig, forwardWeight } from './game/camera';

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
// "me": WASD (camera-relative) + CameraRig. F toggles the rig view, C seats at the nearest seat.
const input = new InputState(window);
walker.rig.root.position.set(14.5, 0, 22);
walker.view.x = 14.5; walker.view.z = 22;
walker.rig.setDrink('americano'); // shows the occasional sip while walking and the cup on the desk when seated
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

// ---------- "me" camera rig (F toggles, C seats) ----------
const rig = new CameraRig(ctx.camera, ctx.renderer.domElement);
(window as unknown as { __preview: unknown }).__preview = { rig, walker }; // dev-only page: handle for manual/automated checks
let seated: Seat | null = null;
const myPos = new THREE.Vector3();
let occluderList: THREE.Object3D[] | null = null; // built once (the scene's top level doesn't change after setup)
const occluders = () => (occluderList ??= ctx.scene.children.filter(o => !actors.some(a => a.rig.root === o) && !(o as THREE.Light).isLight));

// ---------- keys: 1/2 theme, 3-7 zone, 0 none ----------
const ZONE_KEYS: Record<string, ZoneId> = { Digit3: 'lounge', Digit4: 'corridor', Digit5: 'reading', Digit6: 'studyA', Digit7: 'studyB' };
const ZONE_KO: Record<ZoneId, string> = { lounge: '라운지', corridor: '복도', reading: '열람실', studyA: '스터디룸 A', studyB: '스터디룸 B' };
let curZone: ZoneId | null = null;
let themeName = '낮';
let follow = false;
const updateHelp = () => {
  help.textContent = `개발용 3D 미리보기 — 테마: ${themeName} · 현재 구역: ${curZone ?? '없음(전체 밝게)'}\n`
    + '1 낮 · 2 밤 · 3 라운지 · 4 복도 · 5 열람실 · 6 스터디룸 A · 7 스터디룸 B · 0 구역 없음\nF 내 캐릭터 시점 · WASD 이동 · C 가까운 자리 착석/해제 · 드래그 회전 · 휠 확대/축소';
};
updateHelp();
window.addEventListener('keydown', e => {
  if (e.code === 'KeyF') { follow = !follow; if (!follow) { seated = null; rig.setSeatedView(null); } return; }
  if (e.code === 'KeyC') {
    if (seated) { seated = null; rig.setSeatedView(null); walker.rig.setPose('stand'); }
    else {
      const p = walker.rig.root.position;
      let best: Seat | null = null, bd = Infinity;
      for (const s of MAP.seats) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; best = s; } }
      if (best) {
        seated = best; follow = true; rig.setSeatedView(best);
        p.set(best.x, 0, best.z); walker.rig.root.rotation.y = best.facing; walker.rig.setPose('sit');
        walker.view.x = best.x; walker.view.z = best.z;
      }
    }
    return;
  }
  if (e.code === 'Digit1') { blender.setTarget(DAY); themeName = '낮'; }
  else if (e.code === 'Digit2') { blender.setTarget(NIGHT); themeName = '밤'; }
  else if (e.code === 'Digit0') { curZone = null; want.set(MAP.width / 2, 0.8, MAP.depth / 2); dist = 34; }
  else if (ZONE_KEYS[e.code]) {
    curZone = ZONE_KEYS[e.code];
    const r = MAP.zones[curZone];
    want.set((r.x1 + r.x2) / 2, 0.8, (r.z1 + r.z2) / 2);
    // shallow rooms (the 5 m-deep study rooms) need a steep, high view to see past the 3 m walls
    const shallow = r.z2 - r.z1 <= 6;
    dist = shallow ? 22 : 18;
    pitch = shallow ? 1.35 : 0.95;
    if (shallow) yaw = 0;
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
  // the light pool follows "me" in the F view, else the orbit camera's target
  building.update(dtMs, follow ? walker.rig.root.position : target);

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

  if (!seated) {
    const axis = input.axis();
    const r = stepMovement(walker.view, axis, rig.yaw, dtMs / 1000, walkBlocked);
    walker.view.x = r.x; walker.view.z = r.z;
    walker.rig.root.position.set(r.x, 0, r.z);
    if (r.moving) walker.rig.root.rotation.y = r.ry;
    walker.rig.setPose(r.moving ? 'walk' : 'stand');
    if (follow) rig.autoFollow(walker.rig.root.rotation.y, r.moving ? forwardWeight(axis) : 0, dtMs);
  }
  if (follow) {
    myPos.set(walker.rig.root.position.x, 0, walker.rig.root.position.z);
    rig.follow(myPos, dtMs, occluders());
    return;
  }
  rig.yaw = yaw; // WASD stays camera-relative in orbit mode
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

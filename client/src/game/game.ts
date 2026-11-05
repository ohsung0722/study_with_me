// The running game: wires the 3D scene, my movement/camera, other players, HUD/lounge and the socket together.
// Frame order: input → movement → MoveSender → ZoneDimmer.setZone/update → theme → room occupancy (RoomLights)
// → Building.update → avatars/labels → camera/vignette → pickPrompt (+E) → HUD. Rendering follows in the scene loop.
import * as THREE from 'three';
import {
  GREET_TOAST_MS, THEME_FADE_MS, kstDayKey, seatById, zoneAt, zoneKind,
  type JoinOk, type PlayerView, type Profile, type ServerToClient, type TodayStats, type ZoneId,
} from '@studyverse/shared';
import type { GameConnection } from '../net';
import { joinWithRetry } from '../joinFlow';
import { saveProfile } from '../profile';
import { createScene, type SceneCtx } from '../three/scene';
import { buildBuilding, type Building } from '../three/building';
import { ThemeBlender, themeForHour } from '../three/theme';
import { ZoneDimmer } from '../three/zoneDim';
import { Hud } from '../ui/hud';
import { Vignette } from '../ui/vignette';
import { LoungeUi } from '../ui/lounge';
import { TabTitle } from '../ui/tabTitle';
import { BoardTexture } from '../ui/boardTexture';
import { breakEndCheck, breakLeftSec } from '../ui/breakWatch';
import { Radio } from '../audio/radio';
import { CameraRig, forwardWeight } from './camera';
import { InputState } from './input';
import { stepMovement, walkBlocked } from './controller';
import { MoveSender } from './moveSender';
import { pickPrompt, type Prompt } from './interact';
import { SeatTodayCache, seatTodayText } from './seatToday';
import { Avatar, RemotePlayers } from './players';
import { PendingGreet } from './social';
import { devHourFromSearch, liveTodaySec } from './clock';
import { maskBeforeStand, standLocally } from './selfState';
import { RoomLights } from './roomLights';

const THEME_CHECK_MS = 60_000;
const BREAK_CHECK_MS = 1000;   // the break-end alert must also fire while the tab is hidden (no frames then)
const SEAT_TODAY_TIMEOUT_MS = 5000;
const NOTE_MS = 3000;
const OCCLUDER_ROLES = new Set(['wall', 'machine']); // building meshes are named `${zone}:${role}`

const isFocus = (v: PlayerView) => v.status.kind === 'studying' && v.status.focus;

export class Game {
  private profile: Profile;
  private view: HTMLDivElement;
  private ctx: SceneCtx;
  private dimmer = new ZoneDimmer();
  private rooms = new RoomLights(); // study-room lights: on while anyone (me, players, NPCs) is inside
  private markRoom = (x: number, z: number): void => this.rooms.mark(x, z); // a field: no per-frame closure
  private building: Building;
  private blender: ThemeBlender;
  private occluders: THREE.Object3D[] = [];
  private cam: CameraRig;
  private input = new InputState(window);
  private hud: Hud;
  private vignette: Vignette;
  private lounge: LoungeUi;
  private tabTitle = new TabTitle(document);
  private radio = new Radio();
  private board = new BoardTexture();
  private seatCache = new SeatTodayCache((id) => this.fetchSeatToday(id));
  private mover!: MoveSender;
  private remotes: RemotePlayers;
  private myAvatar: Avatar;

  private selfId = '';
  private me = { x: 0, z: 0, ry: 0, moving: false };   // locally predicted
  private myView!: PlayerView;                         // my server view (status, seat, drink)
  private today!: TodayStats;
  private myToday = { sec: 0, day: '' };
  private pending = new PendingGreet();
  private closeGreetToast: (() => void) | null = null;
  private breakAlertedFor: number | null = null;
  private standPending = false;
  private sitPending = false;
  private pickerShown = false;

  private online = true;
  private rejoining = false;
  private replaced = false;
  private disposed = false;
  private notice: HTMLElement | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private offs: (() => void)[] = [];
  private tmp = new THREE.Vector3();
  private promptMe = {} as PlayerView; // my view + predicted position for pickPrompt (reused every frame)
  /** ZoneDimmer factor where (x, z) is (1 outside every zone). A field so the frame loop doesn't allocate it. */
  private dimAt = (x: number, z: number): number => {
    const zn = zoneAt(x, z);
    return zn ? this.dimmer.factor(zn) : 1;
  };

  /** `refreshMs`: display refresh measured before the 3D loop (measureRefresh); 0 = unknown. */
  constructor(root: HTMLElement, private conn: GameConnection, join: JoinOk, profile: Profile, refreshMs = 0) {
    this.profile = { ...profile };
    root.replaceChildren();
    this.view = document.createElement('div');
    this.view.className = 'game-view';
    root.appendChild(this.view);

    this.ctx = createScene(this.view, { refreshMs });
    this.building = buildBuilding(this.ctx.scene, this.dimmer);
    this.ctx.scene.getObjectByName('building')?.children.forEach((o) => {
      if ((o as THREE.Mesh).isMesh && OCCLUDER_ROLES.has(o.name.split(':')[1])) this.occluders.push(o);
    });
    this.blender = new ThemeBlender(themeForHour(this.hour()));
    this.applyTheme();
    const boardMesh = this.ctx.scene.getObjectByName('board');
    if (boardMesh) this.board.attach(boardMesh as THREE.Mesh);

    this.cam = new CameraRig(this.ctx.camera, this.ctx.renderer.domElement);
    this.hud = new Hud(root);
    this.vignette = new Vignette(root);
    this.lounge = new LoungeUi(root);
    this.remotes = new RemotePlayers(this.ctx.scene);
    this.myAvatar = new Avatar(this.ctx.scene, profile.appearance);

    this.listen();
    this.applyJoin(join);

    // Restore the saved radio choice on the first gesture (browsers only start audio from one).
    const resume = () => {
      window.removeEventListener('keydown', resume, true);
      window.removeEventListener('pointerdown', resume, true);
      if (this.radio.current() !== 'off') this.radio.play(this.radio.current());
    };
    window.addEventListener('keydown', resume, true);
    window.addEventListener('pointerdown', resume, true);
    this.offs.push(() => {
      window.removeEventListener('keydown', resume, true);
      window.removeEventListener('pointerdown', resume, true);
    });

    this.timers.push(
      setInterval(() => this.blender.setTarget(themeForHour(this.hour()), THEME_FADE_MS), THEME_CHECK_MS),
      setInterval(() => this.checkBreak(this.serverNow()), BREAK_CHECK_MS),
    );
    this.ctx.onFrame((dt, now) => this.frame(dt, now));
    this.ctx.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.timers.forEach(clearInterval);
    this.offs.forEach((f) => f());
    this.offs = [];
    this.ctx.stop();
    this.input.dispose();
    this.cam.dispose();
    this.hud.dispose();
    this.vignette.dispose();
    this.lounge.dispose();
    this.tabTitle.dispose();
    this.radio.dispose();
    this.remotes.clear();
    this.myAvatar.dispose();
    this.board.dispose();
    this.ctx.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => mat.dispose());
    });
    this.ctx.dispose();
    this.notice?.remove();
    this.view.remove();
  }

  // ---------------------------------------------------------------- session

  private serverNow(): number {
    return Date.now() + this.conn.serverOffsetMs;
  }

  /** (Re)start from a join ack: everything about the previous session is dropped. */
  private applyJoin(j: JoinOk): void {
    this.selfId = j.selfId;
    this.remotes.clear();
    const mine = j.players.find((p) => p.id === j.selfId)!;
    this.myView = { ...mine };
    this.me = { x: mine.x, z: mine.z, ry: mine.ry, moving: false };
    this.myAvatar.rig.setDrink(mine.drink?.id ?? null);
    for (const p of j.players) if (p.id !== j.selfId) this.remotes.upsert(p);
    this.onToday(j.today);
    this.myToday = { sec: j.myTodaySec, day: kstDayKey(j.serverNow) };
    this.mover = new MoveSender((m) => this.conn.socket.emit('move', m));
    this.pending = new PendingGreet();
    this.breakAlertedFor = null;
    this.standPending = this.sitPending = false;
    this.lounge.close();
  }

  private on<E extends keyof ServerToClient>(ev: E, fn: ServerToClient[E]): void {
    const s = this.conn.socket as unknown as { on(e: string, f: unknown): void; off(e: string, f: unknown): void };
    s.on(ev, fn);
    this.offs.push(() => s.off(ev, fn));
  }

  private listen(): void {
    this.on('snapshot', (m) => this.remotes.snapshot(m.t, m.moved));
    this.on('playerJoined', (v) => { if (v.id !== this.selfId) this.remotes.upsert(v); });
    this.on('playerUpdated', (v) => (v.id === this.selfId ? this.applyMine(v) : this.remotes.upsert(v)));
    this.on('playerLeft', ({ id, npc }) => { this.pending.forget(id); this.remotes.remove(id, npc); });
    this.on('correct', ({ x, z }) => { if (!this.myView.seatId) { this.me.x = x; this.me.z = z; } });
    this.on('wave', ({ id }) => (id === this.selfId ? this.myAvatar.rig.wave() : this.remotes.wave(id)));
    this.on('greeted', ({ fromId, fromNick }) => {
      this.pending.set(fromId, Date.now());
      this.closeGreetToast?.();
      this.closeGreetToast = this.hud.toast([{ strong: fromNick }, '님이 인사했어요 👋'], GREET_TOAST_MS,
        { label: '인사 받기', onClick: () => this.acceptGreet(fromId) });
    });
    this.on('today', (s) => this.onToday(s));
    this.on('myToday', ({ sec }) => { this.myToday = { sec, day: kstDayKey(this.serverNow()) }; });
    this.on('replaced', () => { this.replaced = true; this.dispose(); }); // main.ts shows the notice

    const sock = this.conn.socket;
    const onDisconnect = (reason: string) => {
      // 'io client disconnect' = our own (replaced / R21 reconnect inside joinWithRetry)
      if (this.disposed || this.replaced || reason === 'io client disconnect') return;
      this.online = false;
      sock.sendBuffer = []; // nothing from the old session may reach the server after a re-join
      this.showNotice('연결이 끊겼어요. 다시 연결하는 중…');
      if (reason === 'io server disconnect') sock.connect(); // socket.io does not retry this one by itself
    };
    const onConnect = () => { if (!this.online && !this.rejoining) void this.rejoin(); };
    sock.on('disconnect', onDisconnect);
    sock.on('connect', onConnect);
    this.offs.push(() => { sock.off('disconnect', onDisconnect); sock.off('connect', onConnect); });
  }

  private async rejoin(): Promise<void> {
    this.rejoining = true;
    const r = await joinWithRetry(this.conn, this.profile, {
      cancelled: () => this.disposed || this.replaced,
      onFull: () => this.showNotice('지금 독서실이 가득 찼어요. 자리가 나면 자동으로 들어가요'),
    });
    this.rejoining = false;
    if (!r || this.disposed) return;
    if (!r.ok) { this.showNotice('사용할 수 없는 닉네임이에요. 새로고침해 주세요'); return; }
    this.applyJoin(r);
    this.online = true;
    this.notice?.remove();
    this.notice = null;
  }

  private showNotice(text: string): void {
    if (!this.notice) {
      this.notice = document.createElement('div');
      this.notice.className = 'overlay';
      document.body.appendChild(this.notice);
    }
    this.notice.textContent = text;
  }

  private applyMine(v: PlayerView): void {
    const prevSeat = this.myView.seatId;
    if (this.standPending) {
      if (v.seatId === null) this.standPending = false;
      else v = maskBeforeStand(v); // sent before the server handled my stand
    }
    this.myView = { ...v };
    const seat = v.seatId && v.seatId !== prevSeat ? seatById(v.seatId) : undefined;
    if (seat) { this.me.x = seat.x; this.me.z = seat.z; this.me.ry = seat.facing; }
    this.myAvatar.rig.setDrink(v.drink?.id ?? null);
  }

  private onToday(s: TodayStats): void {
    this.today = s;
    this.board.update(s);
  }

  // ---------------------------------------------------------------- frame

  private frame(dtMs: number, nowMs: number): void {
    const serverNow = this.serverNow();

    // input → movement → MoveSender (keys are ignored while a lounge panel is open or offline)
    const blocked = !this.online || this.lounge.isOpen();
    const pressE = this.input.consumePressed('KeyE') && !blocked;
    const axis = this.input.axis();
    if (!blocked && (axis.x !== 0 || axis.z !== 0) && this.myView.seatId) this.standUp(nowMs); // move keys stand up
    this.me.moving = false;
    if (!blocked && !this.myView.seatId) {
      const r = stepMovement(this.me, axis, this.cam.yaw, dtMs / 1000, walkBlocked);
      this.me.x = r.x;
      this.me.z = r.z;
      if (r.moving) this.me.ry = r.ry;
      this.me.moving = r.moving;
      this.cam.autoFollow(this.me.ry, r.moving ? forwardWeight(axis) : 0, dtMs); // camera swings in behind me
      this.mover.update(nowMs, this.me);
    }

    // zones, theme, building (lamp levels read the dimmer, so it updates first)
    const myZone = zoneAt(this.me.x, this.me.z);
    this.dimmer.setZone(myZone);
    this.dimmer.update(dtMs);
    if (this.blender.update(dtMs)) this.applyTheme();
    // lounge + study-room occupancy from everyone's position (others: where they were drawn last frame)
    this.rooms.mark(this.me.x, this.me.z);
    this.remotes.forEachPosition(this.markRoom);
    this.rooms.update(dtMs);
    this.building.update(dtMs, this.me, this.rooms); // the light pool follows me

    // avatars + labels, dimmed by the zone each one stands in
    const dimAt = this.dimAt;
    this.remotes.update(dtMs, serverNow, dimAt);
    const seat = this.myView.seatId ? seatById(this.myView.seatId) ?? null : null;
    this.myAvatar.place(this.me.x, this.me.z, this.me.ry, seat ? 'sit' : this.me.moving ? 'walk' : 'stand', dtMs);
    this.myAvatar.paint(this.myView, serverNow, true, dimAt(this.me.x, this.me.z));
    this.myAvatar.setLabelVisible(!seat); // the seated camera sits right behind it; the HUD shows 🔒 and my time

    // camera + focus vignette centred on me
    this.cam.setSeatedView(seat);
    this.cam.follow(this.tmp.set(this.me.x, 0, this.me.z), dtMs, this.occluders);
    const focus = isFocus(this.myView);
    this.hud.setFocus(focus);
    this.vignette.setActive(focus);
    if (focus) {
      const p = this.tmp.set(this.me.x, 0.9, this.me.z).project(this.ctx.camera);
      this.vignette.setCenter((p.x + 1) * 50, (1 - p.y) * 50);
    }

    // prompt (+E)
    let prompt: Prompt | null = null;
    if (this.online) {
      const me = Object.assign(this.promptMe, this.myView);
      me.x = this.me.x;
      me.z = this.me.z;
      prompt = pickPrompt(me, this.remotes.views(), this.pending.get(Date.now()));
    }
    this.hud.setPrompt(prompt, this.promptNote(prompt));
    if (pressE && prompt) this.act(prompt, nowMs);

    // HUD
    this.hud.setZone(myZone);
    this.syncBreakPicker(myZone);
    this.hud.setMyToday(liveTodaySec(this.myToday, this.myView.status, serverNow));
    this.hud.setBreakLeft(breakLeftSec(this.myView.status, serverNow));
    this.checkBreak(serverNow);
  }

  private hour(): number {
    return devHourFromSearch(location.search) ?? new Date().getHours();
  }

  private applyTheme(): void {
    this.ctx.applyTheme(this.blender.current());
    this.building.applyTheme(this.blender.current());
  }

  // ---------------------------------------------------------------- actions

  private act(p: Prompt, nowMs: number): void {
    const sock = this.conn.socket;
    switch (p.kind) {
      case 'sit': return this.sit(p.seatId, nowMs);
      case 'stand': return this.standUp(nowMs);
      case 'acceptGreet': return this.acceptGreet(p.fromId);
      case 'greet':
        this.mover.flush(nowMs, this.me); // the server measures the distance from my latest position
        sock.emit('greet', (r) => {
          if (!r.ok && r.reason === 'cooldown') this.hud.toast(['잠깐 후에 다시 인사할 수 있어요'], NOTE_MS);
        });
        return;
      case 'machine':
        this.mover.flush(nowMs, this.me);
        return this.lounge.openDrinkMenu(p.id, (drink) => {
          this.mover.flush(performance.now(), this.me);
          sock.emit('drink', { drink }, (r) => {
            if (!r.ok) this.hud.toast(['음료 기계 가까이에서 다시 골라 주세요'], NOTE_MS);
          });
        });
      case 'radio': return this.lounge.openRadioMenu(this.radio.current(), (k) => this.radio.play(k));
      case 'board': return this.lounge.openBoard(this.today);
      case 'focusBlocked': return;
    }
  }

  private sit(seatId: string, nowMs: number): void {
    if (this.sitPending) return;
    this.sitPending = true;
    this.standPending = false;
    this.mover.flush(nowMs, this.me); // the server checks the distance from my latest position
    this.conn.socket.emit('sit', { seatId }, (r) => {
      this.sitPending = false;
      if (!r.ok) this.hud.toast([r.reason === 'taken' ? '이미 누가 앉아 있는 자리예요' : '자리에 조금 더 가까이 가 주세요'], NOTE_MS);
    });
  }

  /** Stand up now (optimistic); the server's playerUpdated confirms. */
  private standUp(nowMs: number): void {
    if (!this.myView.seatId) return;
    this.mover.flush(nowMs, this.me);
    this.conn.socket.emit('stand');
    this.standPending = true;
    ({ view: this.myView, today: this.myToday } = standLocally(this.myView, this.myToday, this.serverNow()));
  }

  private acceptGreet(fromId: string): void {
    if (isFocus(this.myView)) return; // focused: greetings are not taken (the server ignores them too)
    if (!this.pending.take(Date.now(), fromId)) return;
    this.conn.socket.emit('greetAccept', { fromId });
    this.closeGreetToast?.();
    this.closeGreetToast = null;
  }

  private promptNote(p: Prompt | null): string | null {
    if (p?.kind !== 'sit' || seatById(p.seatId)?.kind === 'sofa') return null; // nobody studies on sofas
    const sec = this.seatCache.get(p.seatId);
    return sec === undefined ? null : seatTodayText(sec);
  }

  private fetchSeatToday(seatId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('seatToday timeout')), SEAT_TODAY_TIMEOUT_MS);
      this.conn.socket.emit('seatToday', { seatId }, (r) => { clearTimeout(t); resolve(r.sec); });
    });
  }

  /** Break-minutes chips while I'm in a lounge; a pick goes to the server and into the saved profile. */
  private syncBreakPicker(zone: ZoneId | null): void {
    const want = zoneKind(zone) === 'lounge';
    if (want === this.pickerShown) return;
    this.pickerShown = want;
    if (!want) return this.lounge.hideBreakPicker();
    this.lounge.showBreakPicker(this.profile.breakMinutes, (minutes) => {
      this.profile.breakMinutes = minutes;
      saveProfile(localStorage, this.profile);
      this.conn.socket.emit('setBreakMinutes', { minutes });
    });
  }

  private checkBreak(serverNow: number): void {
    if (this.disposed) return;
    const r = breakEndCheck(this.myView.status, serverNow, this.breakAlertedFor);
    this.breakAlertedFor = r.alertedFor;
    if (!r.alert) return;
    this.hud.toast(['다시 공부하러 갈 시간!'], 6000);
    if (document.hidden) this.tabTitle.alert('⏰ 휴식 끝!');
  }
}

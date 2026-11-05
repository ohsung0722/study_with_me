# Studyverse v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브라우저에서 접속하는 3D 메타버스 독서실 첫 버전. 닉네임 입장, WASD 이동, 자리 착석과 서버 공부 타이머, 구역 판정, 인사, 집중 모드, 공간별 어둡게, NPC 메이트, 공부 기록, 라운지 6요소를 구현한다.

**Architecture:** npm workspaces 모노레포(`shared` / `server` / `client`)로 구성한다.
- `shared`: 맵 데이터(구역·자리·충돌·상호작용 지점), 메시지 타입, 상수, 시간 유틸. 서버와 클라이언트가 같은 데이터로 판정하고 그린다.
- `server`: 게임 로직(`World`)을 통신 계층과 분리한 순수 TypeScript 클래스로 둔다. `World`는 `Outbox` 인터페이스로만 메시지를 내보낸다. Socket.IO 연결 코드는 `net/` 안에만 둔다.
- `client`: Vite + three.js. 화면 UI는 HTML/CSS 오버레이.

**Tech Stack:** Node 26 (`node:sqlite` 내장 DB), TypeScript 5, three ^0.187.0, socket.io / socket.io-client ^4.8.4, express ^5, vite ^8.3.5, vitest ^5.1.0 (+ jsdom), tsx(서버 실행)

**Spec:** `docs/superpowers/specs/2026-11-05-studyverse-design.md` (승인됨). 시안: `.superpowers/brainstorm/72-1793841363/content/*.html`

## Global Constraints

- Node `>=24` (`engines` 필드). DB는 `node:sqlite`의 `DatabaseSync`를 쓴다(네이티브 빌드 없음).
- 모든 UI 문구는 한국어. 사용자가 입력한 문자열(닉네임)은 DOM에 **textContent로만** 넣는다. `innerHTML` 금지.
- PC 데스크톱 브라우저 전용. 휴대폰 접속 시 문구 `PC에서 접속해 주세요` 표시.
- 단위: 1 = 1m. 건물 32m(x) × 24m(z), 입구는 z=24 쪽, 벽 높이 3m.
- 시간대: 낮 07:00–19:00 / 밤 19:00–07:00 (사용자 PC 현지 시각). 테마 전환 1.6초.
- "오늘" = 한국 시간(Asia/Seoul, UTC+9) 자정 기준.
- 다른 구역 밝기 0.45, 구역 전환 0.5초. 복도에서는 전체 1.0.
- 인사: 반경 2m, 보내는 사람 기준 5초 쿨다운, 받은 쪽 안내 5초.
- 닉네임 2–12자(코드 포인트 기준, 앞뒤 공백 제거 후).
- 건물 정원 50명(실제 사람 기준). 건물 ID는 `'main'`. 모든 기록과 room 이름에 건물 ID를 포함한다.
- NPC 메이트: 실제 접속자 3명 미만일 때 등장. 이름표는 보라색 `메이트`. 기록과 랭킹에서 제외.
- 통신 메시지는 순수 JSON. Socket.IO 전용 기능(바이너리, volatile 등)에 의존하지 않는다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 줄을 붙인다.

## Review Focus

1. **클라이언트 시계가 틀린 PC**: 타이머 표시는 서버 시각 기준이어야 한다. 사용자 PC 시계가 10분 틀려도 `00:00:05`가 `00:10:05`로 보이면 안 된다. → Task 12 `labelText`에서 서버 시각 오프셋 테스트.
2. **같은 자리에 동시에 앉기**: 두 명이 같은 틱에 같은 자리로 `sit`을 보내면 한 명만 성공해야 한다. → Task 5 테스트.
3. **앉은 채 연결이 끊기거나 서버가 재시작될 때**: 공부 시간이 사라지면 안 된다. 연결 끊김과 정상 종료(SIGINT/SIGTERM) 모두 세션을 저장해야 한다. → Task 5 `leave` 테스트, Task 10 `shutdown` 테스트.
4. **이상한 닉네임**: 공백만 입력, `<img onerror>` 같은 HTML, 앞뒤 공백, 이모지. 공백만이면 거절하고, HTML은 글자 그대로 보여야 한다. → Task 3 `validateNickname` 테스트, Task 14 `Hud.toast` 테스트.
5. **키를 누른 채 창 전환(Alt+Tab)**: `keyup`을 못 받아 캐릭터가 계속 걷는 버그. 창 포커스를 잃으면 멈춰야 한다. → Task 13 `InputState` 테스트.

---

## File Structure

```
studyverse/
├─ package.json                 workspaces, 공용 스크립트(test, dev, build, start, admin)
├─ tsconfig.base.json
├─ .gitignore                   node_modules, dist, data/*.db, .superpowers/
├─ shared/src/
│  ├─ index.ts                  재수출
│  ├─ constants.ts              Global Constraints의 수치
│  ├─ time.ts                   KST 날짜 키, 자정 분할, 낮/밤, 시간 포맷
│  ├─ map.ts                    MAP 데이터 + zoneAt / isBlocked / seatById
│  ├─ protocol.ts               Profile, PlayerView, 메시지 타입
│  └─ nickname.ts               validateNickname
├─ server/src/
│  ├─ main.ts                   express + http + Socket.IO + 종료 처리
│  ├─ admin.ts                  관리 CLI
│  ├─ store/store.ts            RecordStore (node:sqlite)
│  ├─ game/outbox.ts            Outbox 인터페이스
│  ├─ game/world.ts             World: 입장·이동·착석·구역·휴식·음료·틱
│  ├─ game/greetings.ts         인사 규칙(순수 함수)
│  ├─ game/npc.ts               NPC 메이트 규칙
│  └─ net/socketTransport.ts    Socket.IO ↔ World 연결, Outbox 구현
└─ client/
   ├─ index.html
   ├─ vite.config.ts            /socket.io → localhost:3000 프록시
   ├─ public/audio/             lofi.mp3, rain.mp3, cafe.mp3 (무료 라이선스 음원, 빌더가 준비)
   └─ src/
      ├─ main.ts                부트스트랩
      ├─ profile.ts             익명 ID·프로필 localStorage
      ├─ net.ts                 GameConnection (socket.io-client 래퍼)
      ├─ ui/pcOnly.ts  ui/entry.ts  ui/hud.ts  ui/tabTitle.ts  ui/lounge.ts  ui/vignette.ts
      ├─ three/scene.ts  three/building.ts  three/theme.ts  three/zoneDim.ts
      ├─ three/avatar.ts  three/label.ts
      ├─ game/input.ts  game/controller.ts  game/camera.ts  game/interact.ts
      ├─ game/remotes.ts  game/game.ts
      └─ audio/radio.ts
```

---

### Task 1: 저장소와 shared 기초 (상수 · 시간 유틸)

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `shared/package.json`, `shared/tsconfig.json`, `shared/src/constants.ts`, `shared/src/time.ts`, `shared/src/index.ts`
- Test: `shared/test/time.test.ts`

**Interfaces:**
- Produces:
  - `constants.ts`: `BUILDING_ID='main'`, `TICK_HZ=10`, `WALK_SPEED=4`, `PLAYER_RADIUS=0.35`, `INTERACT_RANGE=1.5`, `GREET_RANGE=2`, `GREET_COOLDOWN_MS=5000`, `GREET_TOAST_MS=5000`, `BUILDING_CAPACITY=50`, `NPC_REAL_THRESHOLD=3`, `NICK_MIN=2`, `NICK_MAX=12`, `BREAK_MINUTES_OPTIONS=[5,10,15] as const`, `DEFAULT_BREAK_MINUTES=10`, `DAY_START_HOUR=7`, `NIGHT_START_HOUR=19`, `THEME_FADE_MS=1600`, `ZONE_FADE_MS=500`, `OTHER_ZONE_BRIGHTNESS=0.45`, `DRINK_LIFETIME_MS=600000`, `DRINKS={coffee:['americano','latte'], vending:['greenTea','ionDrink']} as const`, `HAIR_STYLES=['short','long','bun'] as const`, `TODAY_BROADCAST_MS=10000`
  - `time.ts`: `kstDayKey(ms: number): string`, `splitAtKstMidnight(startMs: number, endMs: number): {dayKey: string; startMs: number; endMs: number}[]`, `isNightHour(hour: number): boolean`, `formatHMS(sec: number): string`, `formatMS(sec: number): string`

- [ ] **Step 1: 저장소 초기화**

`git init`. 루트 `package.json`에 `"workspaces": ["shared","server","client"]`, `"engines": {"node": ">=24"}`, 스크립트 `test`(`vitest run`), `dev`, `build`, `start`, `admin`을 둔다. `.gitignore`에는 `node_modules/`, `dist/`, `data/*.db`, `.superpowers/`를 넣는다. `shared/package.json`의 name은 `@studyverse/shared`, `"exports": "./src/index.ts"`. vitest는 루트에 devDependency로 설치한다.

- [ ] **Step 2: 실패하는 테스트 작성** — `shared/test/time.test.ts`

```ts
test('kstDayKey uses UTC+9', () => {
  expect(kstDayKey(Date.UTC(2026, 10, 4, 14, 59, 59))).toBe('2026-11-04'); // KST 23:59:59
  expect(kstDayKey(Date.UTC(2026, 10, 4, 15, 0, 0))).toBe('2026-11-05');   // KST 00:00
});
test('splitAtKstMidnight splits a 23:50→00:10 KST session into two 600s parts', () => {
  const s = Date.UTC(2026, 10, 4, 14, 50), e = Date.UTC(2026, 10, 4, 15, 10);
  const parts = splitAtKstMidnight(s, e);
  expect(parts.map(p => p.dayKey)).toEqual(['2026-11-04', '2026-11-05']);
  expect(parts.map(p => (p.endMs - p.startMs) / 1000)).toEqual([600, 600]);
});
test('splitAtKstMidnight keeps same-day sessions whole and drops empty ones', () => {
  expect(splitAtKstMidnight(1000, 5000)).toHaveLength(1);
  expect(splitAtKstMidnight(5000, 5000)).toEqual([]);
});
test('isNightHour', () => {
  expect([6, 19, 23, 0].map(isNightHour)).toEqual([true, true, true, true]);
  expect([7, 12, 18].map(isNightHour)).toEqual([false, false, false]);
});
test('formatters', () => {
  expect(formatHMS(3753)).toBe('01:02:33');
  expect(formatMS(312)).toBe('05:12');
  expect(formatMS(-4)).toBe('00:00');
});
```

- [ ] **Step 3: 실패 확인** — Run: `npx vitest run shared/test/time.test.ts` → Expected: FAIL (모듈 없음)
- [ ] **Step 4: `constants.ts`, `time.ts`, `index.ts` 구현.** KST는 고정 오프셋 `9*3600*1000`을 쓴다. 한국은 서머타임이 없으므로 Intl을 쓰지 않는다.
- [ ] **Step 5: 통과 확인** — Run: `npx vitest run shared/test/time.test.ts` → Expected: PASS
- [ ] **Step 6: 커밋** — `git add -A && git commit -m "chore: scaffold monorepo and shared time utils"`

---

### Task 2: 맵 데이터와 공간 판정 (shared/map.ts)

**Files:**
- Create: `shared/src/map.ts`
- Test: `shared/test/map.test.ts`

**Interfaces:**
- Consumes: `PLAYER_RADIUS`, `INTERACT_RANGE`
- Produces:
```ts
export type ZoneId = 'lounge' | 'corridor' | 'reading' | 'studyA' | 'studyB';
export interface Rect { x1: number; z1: number; x2: number; z2: number }
export type SeatKind = 'desk' | 'studyChair' | 'sofa';
export interface Seat { id: string; zone: ZoneId; kind: SeatKind; x: number; z: number; facing: number }
export type InteractableId = 'coffee' | 'vending' | 'radio' | 'board';
export interface Interactable { id: InteractableId; x: number; z: number }
export interface Wall extends Rect { glass: boolean }
export interface Prop extends Rect { kind: 'desk' | 'table' | 'counter' | 'vending' | 'sofa' | 'beanbag' | 'board' | 'plant' }
export const MAP: { width: 32; depth: 24; wallHeight: 3; zones: Record<ZoneId, Rect>;
  walls: Wall[]; props: Prop[]; seats: Seat[]; interactables: Interactable[];
  windows: Rect[]; spawn: { x: number; z: number; facing: number } };
export function zoneAt(x: number, z: number): ZoneId | null;
export function isBlocked(x: number, z: number, radius?: number): boolean; // walls+props vs circle
export function seatById(id: string): Seat | undefined;
```

배치 값(빌더가 그대로 쓴다):
- 구역: lounge `x0–13, z0–24` / corridor `x13–16, z0–24` / reading `x16–32, z0–12` / studyA `x16–32, z12–18` / studyB `x16–32, z18–24`. (스펙은 스터디룸을 "약 8×5m"로 잡았지만, 평면도를 지키려고 오른쪽 폭 16m를 그대로 쓴다. 실제 크기는 16×6m.)
- 문(벽의 빈틈): lounge `x=13, z10–14` / reading `x=16, z9–11` / studyA `x=16, z14–16` / studyB `x=16, z20–22`. 입구 `z=24, x13–16`. 스터디룸이 복도와 맞닿는 벽(`x=16`)은 `glass: true`.
- 열람실 24석: `R01`–`R24`. 6열 × 4행. 책상 중심 `x = 18.6 + 2.4·i (i=0..5)`, `z = 1.8 + 2.6·j (j=0..3)`, 책상 크기 1.6×0.8. 의자(=Seat 위치)는 책상 중심에서 `z+0.85`. facing은 책상 쪽(−z).
- 스터디룸 테이블 중심 (24, 15), (24, 21), 크기 3×1.2. 의자 `A1`–`A6`, `B1`–`B6`. `x ∈ {22.5, 24, 25.5}`, 테이블 중심 기준 `z ± 1.05`.
- 라운지: 소파 2개(각 3석) + 빈백 2개 → `S1`–`S8`, kind `sofa`. 커피머신 `(1.0, 3.0)`, 자판기 `(1.0, 6.0)`, 라디오 `(6.5, 22.5)`, 기록판 `(6.5, 0.4)`. 큰 창은 라운지 뒷벽 `x=0` 쪽 `z4–20`.
- spawn: `(14.5, 23, facing=π)` (안쪽을 바라봄).

- [ ] **Step 1: 실패하는 테스트 작성** — `shared/test/map.test.ts`

```ts
test('seat counts', () => {
  const by = (k: SeatKind) => MAP.seats.filter(s => s.kind === k).length;
  expect(by('desk')).toBe(24); expect(by('studyChair')).toBe(12); expect(by('sofa')).toBe(8);
  expect(new Set(MAP.seats.map(s => s.id)).size).toBe(MAP.seats.length);
});
test('every seat lies in its zone and is standable', () => {
  for (const s of MAP.seats) { expect(zoneAt(s.x, s.z)).toBe(s.zone); expect(isBlocked(s.x, s.z, 0.3)).toBe(false); }
});
test('zoneAt samples', () => {
  expect(zoneAt(5, 5)).toBe('lounge'); expect(zoneAt(14.5, 12)).toBe('corridor');
  expect(zoneAt(20, 5)).toBe('reading'); expect(zoneAt(20, 15)).toBe('studyA');
  expect(zoneAt(20, 21)).toBe('studyB'); expect(zoneAt(-1, 5)).toBeNull();
});
test('walls block, doors do not', () => {
  expect(isBlocked(13, 5)).toBe(true);     // lounge wall
  expect(isBlocked(13, 12)).toBe(false);   // lounge door
  expect(isBlocked(16, 10)).toBe(false);   // reading door
});
test('every seat and interactable is reachable from spawn; farthest desk within 10s walk', () => {
  // BFS on a 0.25m grid with isBlocked(x,z,PLAYER_RADIUS); target = any cell within INTERACT_RANGE of the point
  const dist = gridDistancesFrom(MAP.spawn);   // test helper in the test file
  for (const p of [...MAP.seats, ...MAP.interactables]) expect(reachDistance(dist, p)).toBeLessThan(Infinity);
  const far = Math.max(...MAP.seats.filter(s => s.kind === 'desk').map(s => reachDistance(dist, s)));
  expect(far).toBeLessThanOrEqual(40); // 4 m/s × 10 s
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run shared/test/map.test.ts` → Expected: FAIL
- [ ] **Step 3: `map.ts` 구현.** 벽은 두께 0.2의 Rect로 만들고 문 구간은 비운다. 판정은 원(반지름 r)과 축 정렬 사각형의 최근접점 거리 비교. 소파 Seat는 소파 Prop 바로 앞(통로 쪽)에 둔다. 소파 Prop 자체는 충돌체다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run shared/test/map.test.ts` → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(shared): building map data and spatial queries"`

---

### Task 3: 메시지 타입과 닉네임 검증 (shared/protocol.ts, nickname.ts)

**Files:**
- Create: `shared/src/protocol.ts`, `shared/src/nickname.ts`
- Test: `shared/test/nickname.test.ts`

**Interfaces:**
- Produces:
```ts
export type HairStyle = typeof HAIR_STYLES[number];
export type DrinkId = 'americano' | 'latte' | 'greenTea' | 'ionDrink';
export interface Appearance { hair: HairStyle; hairColor: string; shirtColor: string } // '#rrggbb'
export interface Profile { anonId: string; nickname: string; appearance: Appearance; breakMinutes: 5 | 10 | 15 }
export type Status =
  | { kind: 'none' }
  | { kind: 'studying'; startedAt: number; focus: boolean }
  | { kind: 'break'; endsAt: number };
export interface PlayerView { id: string; nickname: string; appearance: Appearance; isNpc: boolean;
  x: number; z: number; ry: number; zone: ZoneId | null; seatId: string | null; status: Status;
  drink: { id: DrinkId; until: number } | null }
export interface TodayStats { dayKey: string; people: number; totalSec: number; top5: { nickname: string; sec: number }[] }
export interface JoinOk { ok: true; selfId: string; serverNow: number; players: PlayerView[]; today: TodayStats; myTodaySec: number }
export type JoinResult = JoinOk | { ok: false; reason: 'full' | 'nickname' };
export type GreetResult = { ok: true; targetId: string } | { ok: false; reason: 'cooldown' | 'noTarget' | 'focus' };
export type SitResult = { ok: true } | { ok: false; reason: 'taken' | 'far' | 'unknown' };
// C→S 이벤트 이름과 페이로드
export interface ClientToServer {
  join: (p: Profile, ack: (r: JoinResult) => void) => void;
  move: (m: { x: number; z: number; ry: number }) => void;
  sit: (m: { seatId: string }, ack: (r: SitResult) => void) => void;
  stand: () => void;
  greet: (ack: (r: GreetResult) => void) => void;
  greetAccept: (m: { fromId: string }) => void;
  drink: (m: { drink: DrinkId }, ack: (r: { ok: boolean }) => void) => void;
  setBreakMinutes: (m: { minutes: 5 | 10 | 15 }) => void;
  seatToday: (m: { seatId: string }, ack: (r: { sec: number }) => void) => void;
}
// S→C 이벤트
export interface ServerToClient {
  snapshot: (m: { t: number; moved: { id: string; x: number; z: number; ry: number }[] }) => void;
  playerJoined: (p: PlayerView) => void;
  playerUpdated: (p: PlayerView) => void;
  playerLeft: (m: { id: string; npc: boolean }) => void;
  correct: (m: { x: number; z: number }) => void;
  wave: (m: { id: string }) => void;
  greeted: (m: { fromId: string; fromNick: string }) => void;
  today: (s: TodayStats) => void;
  myToday: (m: { sec: number }) => void;
  replaced: () => void;
}
export function validateNickname(raw: string): { ok: true; value: string } | { ok: false; reason: 'length' | 'banned' };
```
금칙어는 `nickname.ts` 안의 짧은 기본 목록(한국어·영어 욕설 20개 안팎)으로 둔다. 비교할 때는 공백과 특수문자를 제거하고 소문자로 바꾼 뒤 부분 일치로 찾는다.

- [ ] **Step 1: 실패하는 테스트 작성** — `shared/test/nickname.test.ts`

```ts
test('trims and accepts 2..12 code points', () => {
  expect(validateNickname('  공부왕  ')).toEqual({ ok: true, value: '공부왕' });
  expect(validateNickname('가')).toEqual({ ok: false, reason: 'length' });
  expect(validateNickname('가'.repeat(13))).toEqual({ ok: false, reason: 'length' });
  expect(validateNickname('   ')).toEqual({ ok: false, reason: 'length' });
});
test('emoji counts by code point', () => { expect(validateNickname('📚📚').ok).toBe(true); });
test('HTML-looking names are allowed as plain text', () => {
  expect(validateNickname('<b>hi</b>')).toEqual({ ok: true, value: '<b>hi</b>' });
});
test('banned words are rejected even with spacing', () => {
  expect(validateNickname(`a ${BANNED_SAMPLE.split('').join(' ')}`)).toEqual({ ok: false, reason: 'banned' });
}); // BANNED_SAMPLE: nickname.ts가 테스트용으로 export하는 목록의 첫 항목
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run shared/test/nickname.test.ts` → Expected: FAIL
- [ ] **Step 3: `protocol.ts`(타입만), `nickname.ts` 구현.** `index.ts`에서 재수출한다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run shared` → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(shared): protocol types and nickname validation"`

---

### Task 4: 기록 저장소 (server/store/store.ts)

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/store/store.ts`
- Test: `server/test/store.test.ts`

**Interfaces:**
- Consumes: `splitAtKstMidnight`, `TodayStats`
- Produces:
```ts
export interface SessionInput { anonId: string; buildingId: string; seatId: string; startMs: number; endMs: number }
export interface RecordStore {
  upsertProfile(anonId: string, nickname: string): void;
  displayName(anonId: string): string;          // 숨김이면 '익명', 관리자가 바꿨으면 바뀐 이름
  addSession(s: SessionInput): void;            // 자정에서 나눠서 여러 행으로 저장
  todayStats(dayKey: string, buildingId: string): TodayStats; // 숨김 프로필은 top5에서 제외(people/total에는 포함)
  userDaySec(anonId: string, dayKey: string): number;
  seatDaySec(seatId: string, dayKey: string, buildingId: string): number;
  setHidden(anonId: string, hidden: boolean): void;
  rename(anonId: string, nickname: string): void; // 관리자 변경. 이후 upsertProfile이 덮어쓰지 않게 admin_name 컬럼에 저장
  deleteSessions(anonId: string, dayKey?: string): number;
  close(): void;
}
export function openStore(path: string): RecordStore; // ':memory:' 지원
```
스키마: `profiles(anon_id TEXT PK, nickname TEXT, admin_name TEXT NULL, hidden INT DEFAULT 0, updated_ms INT)`, `sessions(id INTEGER PK, anon_id TEXT, building_id TEXT, seat_id TEXT, day_key TEXT, start_ms INT, end_ms INT)`. 인덱스는 `(building_id, day_key)`와 `(anon_id, day_key)`.

- [ ] **Step 1: 실패하는 테스트 작성** — `server/test/store.test.ts` (모두 `openStore(':memory:')`)

```ts
test('addSession splits across KST midnight', () => { /* 23:50→00:10 → userDaySec 600 each day */ });
test('todayStats: people, total, top5 order and limit', () => {
  // 6명 각기 다른 시간 → people 6, totalSec 합, top5는 sec 내림차순 5명
});
test('hidden profile is excluded from top5 but counted in people/total', () => {});
test('rename survives later upsertProfile and displayName returns it', () => {});
test('displayName of hidden profile is 익명', () => {});
test('seatDaySec sums only that seat for that day', () => {});
test('deleteSessions removes rows and returns count', () => {});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run server/test/store.test.ts` → Expected: FAIL
- [ ] **Step 3: `node:sqlite`의 `DatabaseSync`로 구현.** 모든 쿼리는 prepared statement로 작성한다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run server/test/store.test.ts` → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(server): sqlite record store"`

---

### Task 5: World 핵심: 입장 · 퇴장 · 착석 · 타이머 · 집중 모드

**Files:**
- Create: `server/src/game/outbox.ts`, `server/src/game/world.ts`
- Test: `server/test/world.seats.test.ts`, `server/test/helpers.ts`(`FakeOutbox`, 가짜 시계)

**Interfaces:**
- Consumes: `RecordStore`, `MAP`, `seatById`, `zoneAt`, `validateNickname`, protocol 타입
- Produces:
```ts
export interface Outbox {
  toAll<K extends keyof ServerToClient>(ev: K, ...a: Parameters<ServerToClient[K]>): void;
  toAllExcept<K extends keyof ServerToClient>(id: string, ev: K, ...a: Parameters<ServerToClient[K]>): void;
  toPlayer<K extends keyof ServerToClient>(id: string, ev: K, ...a: Parameters<ServerToClient[K]>): void;
  setRoom(id: string, room: string | null): void; // `${BUILDING_ID}:${zone}`
  kick(id: string, ev: 'replaced'): void;
}
export interface WorldDeps { now: () => number; store: RecordStore; out: Outbox }
export class World {
  constructor(deps: WorldDeps);
  join(connId: string, profile: Profile): JoinResult;
  leave(connId: string): void;                 // 세션 저장, 자리 비움, playerLeft
  sit(connId: string, seatId: string): SitResult;
  stand(connId: string): void;                 // 세션 저장, myToday 전송
  view(id: string): PlayerView | undefined;
  realCount(): number;
  shutdown(): void;                            // 모든 진행 중 세션 저장
}
```
규칙(스펙 5.4, 5.6, 5.6.2):
- 입장 시 닉네임 검증에 실패하면 `{ok:false, reason:'nickname'}`. 실제 사람이 이미 50명이면 `'full'`. 같은 anonId가 이미 접속해 있으면 이전 연결의 세션을 저장하고 `kick(oldId,'replaced')` 후 제거한다. 이름표에는 `store.displayName(anonId)`를 쓴다. 시작 위치는 `MAP.spawn`.
- 착석: 자리가 있어야 하고(`unknown`), 비어 있어야 하며(`taken`), 거리가 `INTERACT_RANGE + 0.5` 이내여야 한다(`far`). 앉으면 위치를 자리 좌표로 맞춘다. desk·studyChair → `studying{startedAt: now, focus: kind==='desk'}`. sofa → 상태는 바꾸지 않는다(라운지 휴식 유지).
- 일어나기·퇴장 시 studying이었으면 `store.addSession`.

- [ ] **Step 1: 실패하는 테스트 작성** — `server/test/world.seats.test.ts`

```ts
test('join returns self view at spawn and broadcasts playerJoined to others', () => {});
test('join rejects bad nickname and 51st real player (full)', () => {});
test('same anonId joining again kicks old connection with replaced and saves its session', () => {});
test('sit desk → studying focus=true; studyChair → focus=false; sofa keeps status', () => {});
test('second player sitting on the same seat gets taken', () => {}); // Review Focus 2
test('sit too far away → far; unknown seat → unknown', () => {});
test('stand saves a session of exact elapsed seconds and sends myToday', () => {
  // now 0 → sit, now 90_000 → stand ⇒ store.userDaySec == 90, myToday {sec:90}
});
test('leave while seated saves session and frees seat', () => {}); // Review Focus 3
test('shutdown saves all open sessions', () => {});                // Review Focus 3
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run server/test/world.seats.test.ts` → Expected: FAIL
- [ ] **Step 3: `outbox.ts`, `world.ts` 구현.** 플레이어 상태는 `Map<string, PlayerState>`에 둔다. `PlayerState`는 `PlayerView`에 `anonId`, `lastMoveAt`, `lastGreetAt`, `breakMinutes`, `connected`를 더한 형태다.
- [ ] **Step 4: 통과 확인** → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(server): world join/leave/seat/timer"`

---

### Task 6: World 이동 · 구역 · 휴식 상태 · 스냅샷 틱

**Files:**
- Modify: `server/src/game/world.ts`
- Test: `server/test/world.move.test.ts`

**Interfaces:**
- Produces (World에 추가):
```ts
move(connId: string, x: number, z: number, ry: number): void;
setBreakMinutes(connId: string, minutes: 5 | 10 | 15): void;
tick(): void;   // TICK_HZ로 호출. 스냅샷, 음료 만료, NPC 조정(Task 8), 오늘 통계(10초마다)
```
규칙:
- 앉아 있는 동안 `move`는 무시한다(클라이언트가 먼저 `stand`를 보낸다).
- 마지막 이동 이후 `dt`초 동안 `WALK_SPEED·dt·1.5 + 0.5`보다 멀리 움직였거나 `isBlocked(x,z,PLAYER_RADIUS*0.5)`이면 이동을 거부한다. 이때 그 사람에게만 `correct{x,z}`를 마지막으로 인정된 위치로 보낸다.
- 구역이 바뀌면 `out.setRoom(id, \`main:${zone}\`)`를 호출하고 `playerUpdated`를 보낸다. 라운지에 들어오면서 studying이 아니면 `status = break{endsAt: now + breakMinutes·60000}`. 라운지를 나가면 break는 `none`이 된다.
- `tick()`은 이번 틱에 위치가 바뀐 사람만 `snapshot{t, moved}`로 보낸다. 바뀐 사람이 없으면 보내지 않는다.
- 오늘 통계는 `TODAY_BROADCAST_MS`마다 계산한다. `store.todayStats`에 진행 중인 세션의 오늘분을 더하고, 직전과 다를 때만 `today`로 보낸다. 오늘분은 `splitAtKstMidnight(startedAt, now)`에서 오늘 날짜 부분만 쓴다. NPC는 제외한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('valid move updates position and next tick snapshot contains only movers', () => {});
test('no movement → tick sends no snapshot', () => {});
test('teleport or into-wall move is rejected with correct to last valid position', () => {});
test('move while seated is ignored', () => {});
test('entering lounge sets break endsAt = now + 10min; with setBreakMinutes(5) → 5min; leaving clears', () => {});
test('zone change calls setRoom with main:<zone> and emits playerUpdated', () => {});
test('today stats include live sessions and are broadcast only when changed', () => {});
test('today stats count only today part of a live session that started yesterday (KST)', () => {});
```

- [ ] **Step 2: 실패 확인** → Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run server` → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(server): movement validation, zones, break status, snapshots"`

---

### Task 7: 인사와 음료

**Files:**
- Create: `server/src/game/greetings.ts`
- Modify: `server/src/game/world.ts`
- Test: `server/test/greetings.test.ts`, `server/test/world.social.test.ts`

**Interfaces:**
- Produces:
```ts
// greetings.ts (순수 함수)
export function pickGreetTarget(sender: PlayerView & { lastGreetAt: number }, others: PlayerView[], now: number): GreetResult;
// 순서: 보낸 사람이 focus → 'focus'; now - lastGreetAt < 5000 → 'cooldown';
//       반경 2m 안, focus 아님, 자기 자신 아님, NPC 아님 중 가장 가까운 사람 → ok; 없으면 'noTarget'
// World에 추가
greet(connId: string): GreetResult;           // 성공: toAll wave{id:sender}, toPlayer(target, greeted{fromId, fromNick}), 받은 기록 저장
greetAccept(connId: string, fromId: string): void; // fromId가 5초 안에 이 사람에게 인사했을 때만 toAll wave{id:connId}. 쿨다운 없음
takeDrink(connId: string, drink: DrinkId): boolean; // coffee는 americano/latte, vending은 greenTea/ionDrink. 해당 기계에서 INTERACT_RANGE 이내여야 함
```
음료는 `until = now + DRINK_LIFETIME_MS`이고 `playerUpdated`로 알린다. `tick()`에서 만료되면 `drink = null`로 바꾸고 `playerUpdated`를 보낸다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// greetings.test.ts
test('picks nearest eligible within 2m', () => {});
test('focus target is skipped; only focus targets nearby → noTarget', () => {});
test('sender in focus → focus', () => {});
test('second greet within 5s → cooldown; at 5000ms → ok', () => {});
test('npc is never a target', () => {});
// world.social.test.ts
test('greet broadcasts wave and sends greeted only to target', () => {});
test('greetAccept within 5s waves acceptor; after 5s or from non-greeter does nothing', () => {});
test('drink near coffee machine ok; latte at vending fails; far away fails; expires after 10min', () => {});
```

- [ ] **Step 2: 실패 확인** → Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run server` → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(server): greetings and drinks"`

---

### Task 8: NPC 메이트

**Files:**
- Create: `server/src/game/npc.ts`
- Modify: `server/src/game/world.ts` (`tick()`에서 조정)
- Test: `server/test/npc.test.ts`

**Interfaces:**
- Produces:
```ts
export const NPC_SEATS = ['R24', 'R19', 'R14'] as const;   // 입구에서 먼 안쪽 자리
export function npcTarget(realCount: number): number;      // >=3 → 0, 2 → 2, 0~1 → 3
export function makeNpc(index: number, now: number, rand: () => number): PlayerView;
// id `npc-${index+1}`, nickname '메이트', isNpc true, 자리 NPC_SEATS[index],
// status studying{focus:true, startedAt: now - (20~90분 사이 rand)}, 외형은 고정 팔레트에서 index로 선택
```
World 규칙: 실제 사람 수가 바뀌면 다음 `tick()`에서 목표 수에 맞춘다. 줄일 때는 index가 큰 NPC부터 `playerLeft{id, npc:true}`로 내보낸다. 실제 사람이 NPC 자리에 앉으려 하면 `taken`을 돌려준다. NPC는 `addSession`·통계·인사 대상에서 모두 빠진다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('npcTarget table', () => { expect([0,1,2,3,10].map(npcTarget)).toEqual([3,3,2,0,0]); });
test('world adds 3 npcs on first tick with 1 real player, all focused at NPC_SEATS', () => {});
test('third real player joining → next tick removes all npcs with playerLeft npc:true, highest index first', () => {});
test('npcs never appear in todayStats or store', () => {});
test('join ack players list includes current npcs', () => {});
```

- [ ] **Step 2: 실패 확인** → Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run server` → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(server): npc study mates"`

---

### Task 9: Socket.IO 연결 계층

**Files:**
- Create: `server/src/net/socketTransport.ts`
- Test: `server/test/transport.test.ts` (실제 http 서버를 임의 포트에 열고 `socket.io-client` 2개로 접속)

**Interfaces:**
- Consumes: `World`, `Outbox`, `ClientToServer`, `ServerToClient`
- Produces:
```ts
export function attachSocketTransport(io: Server<ClientToServer, ServerToClient>, makeWorld: (out: Outbox) => World): { world: World; stop(): void };
```
연결 1개는 플레이어 1명이다(`connId = socket.id`). `join` 전에 오는 다른 이벤트는 무시한다. `disconnect`가 오면 `world.leave`를 호출한다. `setRoom`은 socket.io의 `join`/`leave`로 구현한다. `TICK_HZ` 간격의 `setInterval`로 `world.tick()`을 부른다. 받은 값이 잘못되면(숫자가 아님, NaN, 모르는 drink) 무시한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('two clients: B sees A join, A moves, B receives snapshot', async () => {});
test('A greets B nearby → B gets greeted, both get wave', async () => {});
test('second socket with same anonId → first receives replaced and is disconnected', async () => {});
test('malformed move payload is ignored without crashing', async () => {});
```

- [ ] **Step 2: 실패 확인** → Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run server/test/transport.test.ts` → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(server): socket.io transport"`

---

### Task 10: 서버 진입점 · 종료 처리 · 관리 CLI

**Files:**
- Create: `server/src/main.ts`, `server/src/admin.ts`
- Test: `server/test/admin.test.ts`, `server/test/main.test.ts`

**Interfaces:**
- Produces:
```ts
// main.ts
export function startServer(opts: { port: number; dbPath: string; clientDist?: string }): Promise<{ port: number; close(): Promise<void> }>;
// close(): world.shutdown() → store.close() → http 종료. SIGINT/SIGTERM에서 close() 호출
// admin.ts
export function runAdmin(argv: string[], env: Record<string, string | undefined>, store: RecordStore): { code: number; out: string };
// 사용법: --key <k> today | hide <anonId> | unhide <anonId> | rename <anonId> <닉네임> | delete <anonId> [dayKey]
// env.STUDYVERSE_ADMIN_KEY가 없거나 --key와 다르면 code 1, out '관리자 키가 올바르지 않습니다'
```
환경 변수: `PORT`(기본 3000), `STUDYVERSE_DB`(기본 `data/studyverse.db`), `STUDYVERSE_ADMIN_KEY`. `clientDist`가 있으면 그 폴더를 정적 파일로 서빙한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('admin rejects missing or wrong key', () => {});
test('admin hide/rename/delete/today operate on store', () => {});
test('admin rename validates nickname', () => {});
test('startServer close() persists a seated client session', async () => {
  // 클라이언트 접속 → 자리 근처 이동(여러 번 move) → sit → close() → 같은 dbPath로 store 열어 userDaySec > 0
});
```

- [ ] **Step 2: 실패 확인** → Expected: FAIL
- [ ] **Step 3: 구현.** 루트 스크립트 `start`는 `tsx server/src/main.ts`, `admin`은 `tsx server/src/admin.ts`.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run server` → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(server): entrypoint, graceful shutdown, admin cli"`

---

### Task 11: 클라이언트 뼈대 · PC 확인 · 입장 화면 · 연결

**Files:**
- Create: `client/package.json`, `client/index.html`, `client/vite.config.ts`, `client/src/main.ts`, `client/src/profile.ts`, `client/src/net.ts`, `client/src/ui/pcOnly.ts`, `client/src/ui/entry.ts`, `client/src/styles.css`
- Test: `client/test/profile.test.ts`, `client/test/pcOnly.test.ts`

**Interfaces:**
- Produces:
```ts
// profile.ts
export function loadProfile(storage: Storage): Profile | null;
export function saveProfile(storage: Storage, p: Profile): void;
export function newAnonId(): string; // crypto.randomUUID()
// localStorage 키 'studyverse.profile.v1'. 깨진 JSON이면 null
// pcOnly.ts
export function isPcLike(ua: string, maxTouchPoints: number, hasFinePointer: boolean): boolean;
// net.ts
export interface GameConnection { socket: Socket<ServerToClient, ClientToServer>; serverOffsetMs: number; join(p: Profile): Promise<JoinResult> }
export function connect(): GameConnection; // 같은 origin. dev에서는 vite proxy
// entry.ts
export function showEntry(root: HTMLElement, initial: Profile | null): Promise<Profile>;
```
입장 화면 구성:
- 닉네임 입력. 검증은 `validateNickname`으로 하고, 오류 문구는 `2~12자로 입력해 주세요` / `사용할 수 없는 단어가 있어요`.
- 머리 모양 3개(짧은 머리, 긴 머리, 똥머리).
- 머리 색 6개, 옷 색 8개 팔레트(빌더가 고름).
- `입장하기` 버튼.

입장 결과가 `full`이면 `지금 독서실이 가득 찼어요. 자리가 나면 자동으로 들어가요`를 띄우고 5초마다 다시 시도한다. `serverOffsetMs`는 `JoinOk.serverNow - Date.now()`로 계산한다. `replaced`를 받으면 게임 화면을 덮는 안내 `다른 탭에서 접속했어요`를 띄우고 다시 연결하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** (jsdom)

```ts
test('save/load roundtrip; corrupt json → null', () => {});
test('isPcLike: desktop Chrome true; iPhone UA false; Android tablet with touch & no fine pointer false', () => {});
```

- [ ] **Step 2: 실패 확인** → Expected: FAIL
- [ ] **Step 3: 구현.** vite 프록시는 `'/socket.io': { target: 'http://localhost:3000', ws: true }`. 루트 `dev` 스크립트는 서버(`tsx watch`)와 vite를 함께 띄운다(`concurrently` 사용).
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run client` → Expected: PASS
- [ ] **Step 5: 수동 확인.** `npm run dev` → `http://localhost:5173`. 입장 화면에서 닉네임을 넣고 입장한다. 서버 로그에 join이 찍히고, 새로고침하면 닉네임이 미리 채워져 있어야 한다.
- [ ] **Step 6: 커밋** — `git commit -am "feat(client): scaffold, entry screen, connection"`

---

### Task 12: 3D 공간 · 낮밤 테마 · 공간별 어둡게 · 아바타 · 이름표

**Files:**
- Create: `client/src/three/scene.ts`, `client/src/three/building.ts`, `client/src/three/theme.ts`, `client/src/three/zoneDim.ts`, `client/src/three/avatar.ts`, `client/src/three/label.ts`
- Test: `client/test/theme.test.ts`, `client/test/zoneDim.test.ts`, `client/test/label.test.ts`

**Interfaces:**
- Consumes: `MAP`, `isNightHour`, `formatHMS`, `formatMS`, `OTHER_ZONE_BRIGHTNESS`, `ZONE_FADE_MS`, `THEME_FADE_MS`, `PlayerView`
- Produces:
```ts
// theme.ts — 값은 시안 space-mood.html의 THEMES.warm(낮)·THEMES.night(밤)
export interface Theme { bg: number; floor: number; wall: number; desk: number; part: number; ambC: number; ambI: number; keyC: number; keyI: number; lamp: number; lampI: number; win: number; rain: number }
export const DAY: Theme; export const NIGHT: Theme;
export function themeForHour(hour: number): Theme;
export function lerpTheme(a: Theme, b: Theme, k: number): Theme;
// zoneDim.ts
export function zoneTargets(current: ZoneId | null): Record<ZoneId, number>; // corridor/null → 모두 1, 그 외 현재만 1 나머지 0.45
export class ZoneDimmer { register(zone: ZoneId, m: THREE.MeshStandardMaterial): void; setZone(z: ZoneId | null): void; update(dtMs: number): void; factor(z: ZoneId): number }
// building.ts
export function buildBuilding(scene: THREE.Scene, dim: ZoneDimmer): { applyTheme(t: Theme): void; seatMarkers: Map<string, THREE.Object3D> };
// avatar.ts — 시안 avatar-rounded.html의 둥근 2등신
export interface AvatarRig { root: THREE.Group; setPose(p: 'stand' | 'walk' | 'sit'): void; wave(durationMs?: number): void; setDrink(d: DrinkId | null): void; setDim(f: number): void; update(dtMs: number): void }
export function createAvatar(a: Appearance): AvatarRig;
// label.ts
export function labelText(v: PlayerView, serverNow: number): { text: string; style: 'normal' | 'me' | 'npc' | 'focus' };
// studying → `${focus?'🔒 ':''}${nickname} ${formatHMS((serverNow-startedAt)/1000)}`, break → `${nickname} 휴식 ${formatMS((endsAt-serverNow)/1000)}`,
// none → nickname, NPC → `메이트 ${formatHMS(...)}` (style 'npc', 보라색)
export class LabelSprite { constructor(); set(text: string, style: string): void; object: THREE.Sprite }
```
벽은 높이 3m, `glass` 벽은 반투명 재질이다. 열람실 책상마다 스탠드(포인트 라이트)를 둔다. 성능상 실제 라이트는 테마의 `lampI > 0`일 때만 켜고 최대 24개다. 비 효과와 달은 `rain` 값에 따라 보이게 한다(시안 `day-night.html` 참고).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('themeForHour: 7..18 DAY, else NIGHT', () => {});
test('lerpTheme endpoints equal inputs', () => {});
test('zoneTargets: corridor/null all 1; lounge → lounge 1 others 0.45', () => {});
test('ZoneDimmer reaches target after ZONE_FADE_MS', () => {});
test('labelText uses serverNow, not local clock', () => {
  // startedAt = 1_000_000, serverNow = 1_005_000 → '... 00:00:05' (Review Focus 1)
});
test('labelText break counts down and clamps at 00:00; npc shows 메이트', () => {});
```

- [ ] **Step 2: 실패 확인** → Expected: FAIL
- [ ] **Step 3: 구현.** 순수 함수가 아닌 three.js 코드는 테스트하지 않는다. `scene.ts`의 렌더 루프는 `requestAnimationFrame`을 쓴다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run client` → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(client): building, themes, zone dimming, avatars, labels"`

---

### Task 13: 내 캐릭터 조작 · 카메라 · 다른 사람 보간

**Files:**
- Create: `client/src/game/input.ts`, `client/src/game/controller.ts`, `client/src/game/camera.ts`, `client/src/game/remotes.ts`
- Test: `client/test/input.test.ts`, `client/test/controller.test.ts`, `client/test/remotes.test.ts`

**Interfaces:**
- Consumes: `isBlocked`, `WALK_SPEED`, `PLAYER_RADIUS`, `TICK_HZ`
- Produces:
```ts
// input.ts
export class InputState { constructor(target: Window); readonly keys: Set<string>; axis(): { x: number; z: number }; consumePressed(code: string): boolean; dispose(): void }
// window 'blur'와 document 'visibilitychange'(hidden)에서 keys를 비운다 (Review Focus 5)
// controller.ts
export function stepMovement(pos: { x: number; z: number }, dir: { x: number; z: number }, yaw: number, dtSec: number,
  blocked: (x: number, z: number) => boolean): { x: number; z: number; moving: boolean; ry: number };
// 카메라 yaw 기준 방향, 속도 WALK_SPEED, 대각선 정규화, x·z 축을 따로 판정해 벽을 따라 미끄러짐
// camera.ts
export class CameraRig { constructor(cam: THREE.PerspectiveCamera, dom: HTMLElement); yaw: number; follow(target: THREE.Vector3, dtMs: number, occluders: THREE.Object3D[]): void; setSeatedView(seat: Seat | null): void }
// 마우스 드래그(또는 포인터 잠금)로 회전. 벽에 가리면 레이캐스트로 캐릭터 쪽으로 당김. 착석 시 책상이 보이는 고정 시점
// remotes.ts
export class Interpolator { push(serverT: number, s: { x: number; z: number; ry: number }): void; sample(serverT: number): { x: number; z: number; ry: number } | null }
// 렌더 시각 = serverNow - 100ms. 두 스냅샷 사이 선형 보간, 마지막 스냅샷 이후는 정지
```
움직이는 동안 `move`를 `TICK_HZ`로 보낸다. 서버에서 `correct`를 받으면 그 위치로 맞춘다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('InputState clears keys on window blur', () => {}); // Review Focus 5
test('stepMovement: 1s forward moves 4m; diagonal still 4m', () => {});
test('stepMovement slides along a wall instead of stopping', () => {});
test('Interpolator midpoint between snapshots; before first → first; after last → last', () => {});
```

- [ ] **Step 2: 실패 확인** → Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run client` → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(client): input, movement, camera, interpolation"`

---

### Task 14: 상호작용 · HUD · 인사 · 집중 모드 · 라운지 UI · 라디오

**Files:**
- Create: `client/src/game/interact.ts`, `client/src/ui/hud.ts`, `client/src/ui/tabTitle.ts`, `client/src/ui/lounge.ts`, `client/src/ui/vignette.ts`, `client/src/audio/radio.ts`
- Test: `client/test/interact.test.ts`, `client/test/hud.test.ts`, `client/test/tabTitle.test.ts`

**Interfaces:**
- Consumes: `MAP`, `INTERACT_RANGE`, `GREET_RANGE`, `PlayerView`, `formatHMS`
- Produces:
```ts
// interact.ts
export type Prompt =
  | { kind: 'sit'; seatId: string; text: 'E 앉기' } | { kind: 'stand'; text: 'E 일어나기' }
  | { kind: 'greet'; targetId: string; text: 'E 인사하기' } | { kind: 'focusBlocked'; text: '🔒 집중 중' }
  | { kind: 'machine'; id: 'coffee' | 'vending'; text: 'E 음료 고르기' } | { kind: 'radio'; text: 'E 배경음 바꾸기' }
  | { kind: 'board'; text: 'E 기록판 보기' } | { kind: 'acceptGreet'; fromId: string; text: 'E 인사 받기' };
export function pickPrompt(me: PlayerView, others: PlayerView[], pendingGreetFrom: string | null): Prompt | null;
// 우선순위: 앉아 있음 → stand(단 pendingGreet가 있고 내가 focus가 아니면 acceptGreet) > acceptGreet > 기계/라디오/기록판(INTERACT_RANGE) > 빈 자리(INTERACT_RANGE)
//          > 사람(GREET_RANGE, focus면 focusBlocked, 내가 focus면 표시 안 함)
// hud.ts
export class Hud { constructor(root: HTMLElement); setZone(z: ZoneId | null): void; setFocus(on: boolean): void; setMyToday(sec: number): void; setPrompt(p: Prompt | null): void; toast(parts: (string | { strong: string })[], ms: number, action?: { label: string; onClick(): void }): void }
// 구역 표기: lounge '라운지', corridor '복도', reading '열람실', studyA '스터디룸 A', studyB '스터디룸 B'
// tabTitle.ts
export class TabTitle { constructor(doc: Document); alert(text: string): void; clear(): void } // 탭이 보이게 되면 자동 clear, 원래 제목 복원
// vignette.ts — 시안 focus-dim.html의 radial-gradient 방식
export class Vignette { constructor(root: HTMLElement); setActive(on: boolean): void; setCenter(xPct: number, yPct: number): void }
// radio.ts
export type RadioKind = 'lofi' | 'rain' | 'cafe' | 'off';
export class Radio { play(kind: RadioKind): void; current(): RadioKind } // /audio/{kind}.mp3 반복 재생, 선택은 localStorage 'studyverse.radio'
```
동작:
- **인사**: E → `greet` ack. `cooldown`이면 토스트 `잠깐 후에 다시 인사할 수 있어요`. `greeted`를 받으면 토스트 `{strong: fromNick}님이 인사했어요 👋`와 `[인사 받기]` 버튼을 5초 띄운다. `wave`를 받으면 해당 아바타 `wave()`.
- **집중 모드**: 내 상태가 `studying.focus`이면 `Hud.setFocus(true)`(문구 `🔒 집중 모드 · 인사를 받지 않아요`)와 `Vignette.setActive(true)`. 카메라는 `setSeatedView`.
- **휴식**: 상태가 break이면 HUD에 남은 시간을 띄운다. `endsAt`이 지나는 순간 한 번만 토스트 `다시 공부하러 갈 시간!`을 띄운다. 탭이 숨겨져 있으면 `TabTitle.alert('⏰ 휴식 끝!')`과 파비콘 변경. 휴식 시간 선택(5/10/15분)은 라운지 UI에 두고 `setBreakMinutes`를 보낸다.
- **음료**: 기계 E → 메뉴(커피머신: 아메리카노/라떼, 자판기: 녹차/이온음료) → `drink`. 내 아바타 `setDrink`. 걸을 때 가끔 마시는 동작. 앉으면 컵을 책상 위에 놓는다.
- **기록판**: E → 패널. `today` 데이터(`오늘 N명 · 총 H시간`, TOP 5)를 보여준다. 기록판 메쉬 표면에도 같은 내용을 캔버스 텍스처로 그린다.
- **자리 기록**: 빈 자리 프롬프트가 뜨면 `seatToday`를 조회해 `오늘 이 자리에서 N시간 M분 공부했어요`를 함께 표시한다(자리당 30초 캐시).
- **이동 키로 일어나기**: 앉아 있을 때 WASD를 누르면 `stand`를 보낸 뒤 이동한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('pickPrompt: near free desk → sit; seated → stand', () => {});
test('pickPrompt: near focused player → focusBlocked; near normal player → greet', () => {});
test('pickPrompt: I am focused → no greet prompt', () => {});
test('pickPrompt: pending greet → acceptGreet takes priority over sit/greet', () => {});
test('Hud.toast renders nickname as text (no HTML injection)', () => {
  // toast([{strong:'<img src=x onerror=alert(1)>'}, '님이 인사했어요 👋'], 1000) → root.querySelector('img') === null, textContent에 원문 포함 (Review Focus 4)
});
test('TabTitle.alert sets title and restores on visibilitychange to visible', () => {});
```

- [ ] **Step 2: 실패 확인** → Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run client` → Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(client): interactions, hud, greetings, focus mode, lounge"`

---

### Task 15: Game 조립과 전체 확인

**Files:**
- Create: `client/src/game/game.ts`
- Modify: `client/src/main.ts`
- Create: `README.md` (실행 방법, 환경 변수, 관리 명령, 음원 라이선스 기록 칸)

**Interfaces:**
- Consumes: Task 11–14의 모든 클라이언트 모듈, `GameConnection`
- Produces: `export class Game { constructor(root: HTMLElement, conn: GameConnection, join: JoinOk, profile: Profile); dispose(): void }`

`Game`이 하는 일:
- 플레이어 맵을 관리한다(`playerJoined` / `playerUpdated` / `playerLeft`). NPC가 퇴장할 때는 일어나 문 쪽으로 2초 걷고 사라지는 연출을 한다.
- 스냅샷을 `Interpolator`에 넣는다.
- 매 프레임: 입력 → 이동 → `ZoneDimmer.setZone(zoneAt(me))` → 카메라 → 이름표 → `pickPrompt` → HUD 갱신 순서로 처리한다.
- 1분마다 `themeForHour(new Date().getHours())`로 목표 테마를 다시 정하고 `THEME_FADE_MS` 동안 섞는다. 개발용 URL 파라미터 `?hour=21`이 있으면 그 시각을 쓴다.
- 다른 사람 아바타와 이름표는 그 사람이 있는 구역의 `ZoneDimmer.factor(zone)`로 흐리게 한다(`AvatarRig.setDim`, 이름표 투명도 `0.55 + 0.45·factor`).

- [ ] **Step 1: 조립 구현**
- [ ] **Step 2: 전체 테스트** — Run: `npm test` → Expected: 모든 테스트 PASS
- [ ] **Step 3: 빌드** — Run: `npm run build` → Expected: `client/dist` 생성, 타입 오류 없음
- [ ] **Step 4: 수동 확인 (브라우저 창 2개, 서로 다른 닉네임)** — `npm run dev`로 띄우고 아래를 하나씩 확인한다.
  1. 입장하면 입구에서 시작하고, 혼자일 때 열람실에 `메이트` 3명이 앉아 있다.
  2. WASD와 마우스로 걷는다. 벽과 책상을 통과하지 못한다. 창 전환 후 돌아와도 캐릭터가 저절로 걷지 않는다.
  3. 복도에서는 전체가 밝고, 라운지에 들어가면 다른 공간이 어두워진다. 이름표는 `휴식 10:00`부터 줄어든다.
  4. 커피머신에서 라떼를 고르면 컵을 들고, 상대 창에서도 컵이 보인다.
  5. 라운지에서 상대에게 E를 누르면 손을 흔들고, 상대에게 토스트가 뜬다. 받으면 상대도 손을 흔든다. 5초 안에 다시 누르면 쿨다운 문구가 뜬다.
  6. 열람실 책상에 앉으면 집중 모드가 된다. 비네트가 생기고 🔒 표시가 붙으며 타이머가 돈다. 상대가 다가오면 `🔒 집중 중`만 보이고 인사할 수 없다.
  7. 탭을 숨기고 1분 뒤에 돌아와도 타이머가 계속 올라가 있다.
  8. 일어난 뒤 기록판의 `오늘 N명 · 총 H시간`과 내 오늘 시간이 늘어 있다.
  9. 두 번째 사람이 들어오면 메이트가 2명으로, 세 번째 사람이 들어오면 0명으로 줄어든다.
  10. 같은 브라우저 새 탭으로 접속하면 이전 탭에 `다른 탭에서 접속했어요`가 뜬다.
  11. PC 시각을 19시 이후로 바꾸거나 시각을 강제하는 개발 플래그 `?hour=21`을 쓰면 밤 테마(비, 스탠드)로 바뀐다.
  12. 라디오에서 빗소리를 고르면 나에게만 들리고, 새로고침해도 유지된다.
- [ ] **Step 5: 커밋** — `git commit -am "feat: assemble studyverse v1"`

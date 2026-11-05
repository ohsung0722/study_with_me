# Study rooms (v1.2): furnished rooms, windows, lights that turn on when occupied

User request (2026-11-05): "스터디룸에 책상 하나만 너무 덩그러니 있는 것 같아. 칠판이나 모니터같은 요소를 배치해줘. 창문도 있으면 좋겠다. 그리고 지금 스터디룸에 들어가면 불이 들어오지 않는데 이거 불 들어오게하면 안되나"

Current state: studyA (x16–36, z14–19) and studyB (x16–36, z19–24) each hold one 3 × 1.2 table at x=26 with 6 chairs; a night-only pendant over the table; otherwise bare walls. By day the rooms read dim and empty.

## 1. Furnish each study room
Make them read as real group-study rooms (warm, cozy, consistent with the approved style):
- **Whiteboard / chalkboard** on a long wall the table faces sideways to (e.g. the far end wall x≈36 or the shared wall), with a tray, a few marker strokes / sticky notes as texture detail.
- **Wall-mounted monitor / TV** (dark screen with a subtle glow or a static "slide" texture) on the wall opposite the whiteboard or beside it.
- Optional small touches: a low shelf or cabinet, a plant, a wall clock, a coat rack. Keep the walk from the door to every chair clear.
- Solid items that a player could walk into (cabinet, shelf, big plant) go into `MAP.props` so server and client collide identically; wall-mounted things (boards, monitor, clock) can be client-only meshes.
- Studies room A and B may mirror each other or differ slightly; both must look furnished.

## 2. Windows
- Add windows on the outer walls of the study rooms: the east wall x=36 for both rooms (and optionally the south wall z=24 for room B). Rendered like the lounge window (daylight sky by day; night sky with the same rain/moon treatment by night), dimmed with the room's zone factor.
- Add them to `MAP.windows` if that's how the client builds windows; walls stay solid colliders (windows are visual).

## 3. Lights turn on when someone is in the room
- Each study room has ceiling lights (the existing pendant over the table, plus e.g. 1–2 ceiling panels or more pendants) that are **on while at least one player (real or NPC, including me) is inside that room**, day and night, and fade off a few seconds (~3 s) after the room empties. Fade on/off over ~0.4 s.
- Occupancy is derived on each client from the player positions it already has (`zoneAt` of every player incl. me) — no server change. Everyone therefore sees the same lit/unlit rooms, which doubles as a "room in use" signal from the corridor.
- When lit, the room should look clearly bright and warm (surfaces lit via glow/fill, the table area bright), by day as well as by night. When unlit by day it can stay as today; at night unlit stays dark (lofi).
- Light budget: **real PointLights stay ≤ 6** (light pool). Study-room lights are pool sources (with the occupancy-scaled intensity) plus emissive shades and glow pools. No light `.visible` toggling.
- Pure, unit-tested occupancy logic (players → per-room target level with the off-delay and fade).

## Acceptance
- `npm test` green (map tests updated/added for new props: seats standable, door-to-every-chair reachable), `npm run build` clean.
- In `/preview.html`: both study rooms look furnished with a board, a monitor and windows; walking "me" (F + WASD) into a study room turns its lights on smoothly, leaving turns them off after the delay; stats show ≤ 6 lights.

## Result (2026-11-05)

**What changed**
- `shared/src/map.ts`: new prop kinds `cabinet` and `coatRack`. Each study room gets a low `bookshelf` (2.0 × 0.4) and a low `cabinet` (1.8 × 0.45) against its north wall. They sit at opposite ends in A and B (A: shelf x18.6, cabinet x30.4; B: swapped). Each room also gets a `coatRack` in the corner beside the door (16.55, north + 0.45) and a `bigPlant` by the east window (A in the SE corner, B in the NE corner). `MAP.windows` gains A east (x=36, z14.7–18.3), B east (z19.7–23.3) and B south (z=24, x30.4–34.0). The lounge window stays first, and the walls stay solid colliders.
- `client/src/game/roomLights.ts` (new, pure, no three.js): `RoomLights` with `mark(x, z)` for every player position each frame, then `update(dt)` and `level(zone)`. `stepRoomLight` fades on linearly over 0.4 s while anyone is inside. Once the room is empty the light holds 3 s and then fades off over 0.4 s. Rooms are independent. It updates in place, so nothing is allocated per frame.
- `client/src/three/building.ts`:
  - **Decor:** each room gets a rug under the table, and a whiteboard on the north wall centred on the table. The whiteboard has an aluminium frame, a marker tray with markers and an eraser, notes in blue/black/red, a boxes-and-arrow sketch, a circled formula and five sticky notes. A wall monitor on the opposite (south) wall has a soundbar and a static slide `CanvasTexture`. The slide is bright while the room is lit and stays in near-black standby otherwise. There is also a wall clock above the cabinet, plus renderers for the cabinet (doors, handles, binders, papers, pen cup, plant) and the coat rack (coat, scarf, tote bag). Small items use the per-zone vertex-coloured `decor` mesh; the lounge clock became a shared `wallClock()`.
  - **Windows:** a generic builder replaces the lounge-only code. Per zone there is one merged sky mesh, one rain `InstancedMesh` and one moon in the zone's first window, all dimmed with the zone. Frames merge into the zone's `part` mesh, so the lounge frame is one draw call fewer.
  - **Lights:** each study room has three pendants: the table one plus two smaller ones at x±5.5. One shade mesh per room. All three are light-pool candidates with intensity `PENDANT_I × level × dim`. They get table and floor glow pools and a pendant fill on walls, floor, part and decor, with the day glow at 0.5 and the day fill at 0.5. Their level comes from occupancy (smoothstep-eased), not from night, so they work by day too.
  - **Night colours:** a lit room at night keeps 45 % × its light level of its daytime colours (the same idea as the corridor). Without this the navy night floor and walls stayed dark even under the lamps. Unlit rooms at night stay lofi-dark.
  - `update(dt, focus, rooms?)`: a missing `rooms` means every room is off.
- `client/src/game/players.ts`: `RemotePlayers.forEachPosition(fn)` reports the rendered positions; seated players are at their seat.
- `game.ts`: `rooms.mark(me)`, then every remote (players and NPCs, using last frame's drawn position), then `rooms.update(dt)` before `building.update(…, this.rooms)`. A bound field is used, so there is no per-frame closure.
- `preview.ts`: every actor is marked, so the walking "me" counts too. `window.__preview.rooms` is exposed.

**Tests** (written first)
- `shared/test/map.test.ts` +3:
  - Each study room has a table, cabinet, coat rack, big plant and shelf, all wholly inside the room's inner walls.
  - From just inside each room's door, every chair's own grid cell can be reached on foot (≤ 16 m). The door approach and the lane to the table end stay clear.
  - The east windows of A and B and B's south window exist, the walls stay solid, and the lounge window is still first.
  - The lounge zone check now skips study-room props. The existing tests still check that seats are standable at PLAYER_RADIUS and that everything is reachable from spawn.
- `client/test/roomLights.test.ts` (11): linear fade on and off, hold for the off delay, re-entry cancels the delay, reversing mid-fade causes no pop, dt ≤ 0 is a no-op, only the study rooms light up, a seated NPC counts, off about 3 s after empty and dark about 0.4 s later, rooms are independent, marks count for one update only, and positions outside the building are ignored.
- `client/test/buildingLights.test.ts` +3:
  - Lights follow occupancy day and night: an empty room has no pool light, glow or shade. A lit room has at least 2 pool lights near me while the other room stays dark. From afar a lit room shows glow and wall fill. With no levels passed, rooms stay dark. There are always ≤ 6 lights, all visible.
  - At night a lit room's colours are brighter than an unlit room's, and they return to dark after the room empties. By day the colours do not depend on the lights.
  - Windows, rain, monitors and decor exist; the screen wakes with its room; rain is visible only at night; windows dim with their zone.
- `client/test/remotePlayers.test.ts` +1: `forEachPosition`.
- `npm test` → `Test Files 47 passed (47)`, `Tests 353 passed (353)` (was 46 files, 335 tests). No stderr or warnings.
- `npm run build` → tsc ×3 clean, `vite build client` ✓ (index 128 kB, three 553 kB, no warnings).

**Preview** (`npx vite client --port 5182 --strictPort` through a temporary launch.json entry, since reverted; `/preview.html?stats=1`; 5173 untouched; server stopped)
- No console errors. The pane was hidden, so rAF only ran at about 1 Hz and the scene loop's 100 ms dt clamp stretched the fades in wall-clock time.
- **Day overview:** `calls 212 | tris 203k | lights 6` (v1.1: 200 / 190k).
- **Night overview:** `calls 217 | tris 204k | lights 6`.
- Both rooms look furnished: rug, whiteboard, low shelf, cabinet, coat rack, plant, east windows, plus B's south window.
- Room A is lit throughout because the preview's seated NPC 도윤 (A2) is in it.
- **Walking "me" into B** (through `__preview.walker.view`): B's level went 0 → 0.25 → 0.5 → 0.75 → 1 over four 100 ms-clamped frames. After moving "me" to the corridor, B held at 1 for the delay, then faded to 0 smoothly.
- **Night:** lit rooms read warm brown with bright table pools and glowing shades; the reading room and unlit B stay lofi navy. Rain runs on all study windows, with a moon in each room.
- **Close-up of B with a temporary page-side camera override (not in code):**
  - At night: the slide shows on the monitor above the soundbar, rain is on the east and south windows, and the pendants are lit. The whiteboard shows the sketch, sticky notes and markers, and the cabinet, clock and coat rack sit by the door.
  - By day the same view is clearly bright and warm, with daylight windows.

**Trade-offs**
- About +12 draw calls by day and +17 at night (per room: decor, sky, monitor and pendant-shade meshes; rain and moon at night). About +14k triangles, mostly the low shelves' books.
- Occupancy uses other players' drawn positions from the previous frame (one frame of lag), so an NPC walking out counts until it disappears.
- Point lights still pass through walls (no light shadows). A pooled study pendant may slightly light the reading-room desks right behind the z=14 wall, the same as the v1.1 pendant.
- The monitor shows one static slide. The clocks are decorative (10:10).
- With the 5 m-deep rooms, the in-game follow camera pulls in close near the walls; the monitor and whiteboard are best seen from the table.

### Follow-up round (after review)
1. **Follow camera in the study rooms.**
   - `camera.ts` adds `STUDY_PITCH_FLOOR = 0.85` and `PITCH_FLOOR_TAU_MS = 300`, plus the pure functions `pitchFloorFor(zone)` (0.85 in studyA/studyB, 0 elsewhere) and `approachPitchFloor(cur, target, dt)` (exponential).
   - `CameraRig` gets `pitchFloor` and `updatePitchFloor(zone, dt)`. The desired position uses `max(pitch, pitchFloor)`, and the player's own pitch is left untouched.
   - `game.ts` calls `updatePitchFloor(myZone, dt)` every frame; the preview does the same in follow mode.
   - Preview check (night, room B, follow mode; in-page numbers, because the hidden pane rendered at only 168×95):
     - Facing the whiteboard: camera elevation 0.835, boom 4.66 m and still easing out, whiteboard centre on-screen with a line of sight clear of the 3 m walls.
     - Facing the monitor: elevation 0.85, full 5.0 m boom, monitor on-screen and clear.
     - For comparison, the review measured about 2.5 m mid-room at pitch 0.5.
2. **Pendant range:** `PENDANT_DIST` 4.5 → 3.3 and `PENDANT_I` 8 → 9.5 (+19 %); the table pendant's floor glow radius 4 → 3.4 to match.
   - Checked with three's point-light falloff instead of by eye (the pane was too small to judge). The worst irradiance on the reading-room strip z 12–13.9, and on room B's north strip, from room A's pendants drops from 0.74 to 0.05.
   - The floor under the chairs in the lit room stays within 6 % (2.87 → 2.71).
3. **`paintStudyRoom`:**
   - It now tracks the painted "lift" (`STUDY_NIGHT_KEEP × night × level`) and repaints only at night, and only when the lift has moved more than 0.002. Day → night changes still repaint through `applyTheme`.
   - `lerpTheme(a, b, k, out?)` can write into a reused scratch theme, and the per-zone material lists are built once, so a fade allocates nothing per frame.
4. **`RemotePlayers.forEachPosition`** uses `this.map.forEach`.
5. **Tests:**
   - New `client/test/cameraPitchFloor.test.ts` (5): which zones get the floor, the easing (one time constant, frame-rate independence, dt ≤ 0), the rig using `max(pitch, floor)` without touching `pitch`, and `updatePitchFloor` easing in and back out.
   - `theme.test.ts`: the scratch `lerpTheme`.
   - `buildingLights.test.ts`: lounge window regression (160 rain drops, moon at (0.106, 2.2, 16.8), sky plane bounds, dims with the lounge zone).
   - The roomLights test is renamed to "outside the building (or not a number)".
- `npm test` → `Test Files 48 passed (48)`, `Tests 360 passed (360)`, no stderr. `npm run build` clean (index 129 kB).
- Preview vite on 5182 stopped, launch.json restored, viewport emulation reset; no console errors.

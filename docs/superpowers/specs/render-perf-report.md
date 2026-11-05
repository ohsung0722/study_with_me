# Render performance pass: report

Spec: `2026-11-05-render-perf.md`. Branch `feat/studyverse-v1`.

Commits:
- `689314d` feat(client): dev stats overlay (`?stats=1`). Landed first so the baseline could be measured on the old renderer.
- `2dd47ea` perf(client): light pool, fake lamp glow, adaptive resolution and 60 fps cap
- (this report is in the commit after these two)

## Results

Measured in the dev preview (`/preview.html?stats=1`) on this laptop's **Intel UHD Graphics (ANGLE / D3D11)**. Canvas: 1280×720 CSS at pixel ratio 1.5, so **1920×1080 rendered pixels**. Each scene state was fully settled first: theme, zone dim and camera.

**GPU throughput** is the main number. It's the time per frame when 30–60 frames are rendered back to back and the GPU is synced once at the end.

| state | before ms/frame (≈fps) | after ms/frame (≈fps) |
|---|---|---|
| day, overview | 34.3–35.3 (≈29) | 5.1–5.2 (≈195) |
| day, reading room (zone 5) | 46.1–47.3 (≈21) | 6.9 (≈145) |
| night, overview | 41.5–41.8 (≈24) | 4.9–5.0 (≈200) |
| night, reading room | 55.7–55.9 (≈18) | 6.9–7.2 (≈140) |
| night, lounge | 50.3–51.4 (≈20) | 6.3 (≈158) |
| night, study room A | 59.4–60.0 (≈17) | 7.2–7.5 (≈135) |

The live loop is capped at 60 fps, so on this hardware the after numbers leave a lot of headroom.

**Live stats overlay, before only.** The pane was rendering at the time, at 1920×1080 with ratio 1.50 and MSAA on:

| state | fps | frame ms | calls | tris | ratio | lights |
|---|---|---|---|---|---|---|
| day overview | 17–27 | 37–42 | 183–184 | 158.5k | 1.50 | 24 |
| day reading | 17–20 | 49–53 | 136 | 126.1k | 1.50 | 24 |
| night overview | 16.8–18 | 55–60 | 186 | 158.9k | 1.50 | 31 |
| night reading | 14.5–16 | 61–65 | 137 | 126.4k | 1.50 | 31 |
| night lounge | 15–18 | 55–66 | 151 | 129.2k | 1.50 | 31 |

**Live stats overlay, after.** The Browser pane was **hidden** for the rest of the session. rAF ran at about 1–8 fps and only advanced when a screenshot was taken, so live fps couldn't be read. What the overlay did show after the change:
- `calls` 148–190 and `tris` 129–159k, about the same as before. The 5 glow meshes add ≤ 5 draw calls.
- `lights 6`, `tier high`.
- The ~1000 ms throttled frames were correctly ignored by the quality controller: it stayed at tier high with the ratio unchanged.

**Other measurements:**
- **Sync bench.** Render plus `readPixels` per frame, which includes pipeline latency. 42–53 ms before, 9–12 ms after.
- **Point lights.** 31 before, **6** after, in every state.
- **Shader programs.** Before: 7 by day, growing to 13–14 after day→night (recompiles from `.visible` toggles). After: **10, constant** across day, night and all zones.
- **MSAA.** On before; off after at dpr 1.5, per spec.

## What changed, per requirement

1. **Light pool** (`client/src/three/lightPool.ts`).
   - `LIGHT_POOL_SIZE = 6` PointLights are created once and stay `visible`. Unused slots sit at intensity 0.
   - The pure `selectLamps` picks lamps by `lampScore = intensity / (1 + d²)` in the floor plane, where intensity already includes theme level × zone dim factor. `assignSlots` keeps slots on lamps that are still picked and prefers a slot already sitting on a lamp, so lights don't jump.
   - `LightPoolState` re-picks every 150 ms and eases intensity exponentially (~95 % after 250 ms). A slot only moves to a new lamp after it has faded to dark, so nothing pops.
   - Candidate sources: the 24 desk lamps (when `lampI > 0`), plus at night the 5 lounge lamps and 2 pendants.
   - The focus is my avatar in the game. In the preview it is the walker in the F view, otherwise the orbit target.
   - `building.ts` creates no other lights. Nothing toggles `.visible` on a light anywhere (grep: only rain, moon, labels and the wave sprite).
2. **Fake glow** (`client/src/three/glow.ts`).
   - One shared 64² CanvasTexture holds the radial gradient. Each lamp gets quads that are additive, `depthWrite: false` and polygon-offset.
   - Quads are clipped to the surface they lie on, with UVs keeping the gradient centred on the lamp: desk top + reading-room floor for desk lamps, table + floor for pendants, stand surface + floor for lounge lamps.
   - All quads of a zone form one mesh, so **5 draw calls**. Strength goes into vertex colours (lamp colour × surface colour × level).
   - Level = lamp level × zone dim factor, matching what the old real lights used, × (1 − the share a pool light currently carries). A lamp crossfades between glow and real light instead of doubling up.
   - **Additions beyond the spec, to keep the approved look** (details under Look differences):
     - (a) a per-zone **lamp fill**: an emissive term on that zone's materials, standing in for the summed light of the lamps without a pool light on walls, partitions and chairs;
     - (b) a small untinted **sheen** in the glow, replacing the specular sheen PBR used to leave on dark surfaces;
     - (c) day-time scale factors for fill and glow. Additive blending happens after sRGB encoding, which over-brightens bright daytime surfaces.
3. **Resolution** (`client/src/three/quality.ts`).
   - Cap `min(dpr, 1.5)`, floor 0.6, ×0.85 steps.
   - Each 1.5 s window: average > 22 ms steps down; < 13 ms for ~3 s steps back up to the cap; the 13–22 ms band holds.
   - Hysteresis: a step down within ~3.5 s of a step up doubles the wait before the next step up (up to 48 s).
   - Samples over 250 ms are ignored (hidden tab, GC, shader compile).
   - Frame time = time from a rendered rAF tick to the next tick.
   - On displays whose refresh interval is ≥ 13 ms, the fast threshold becomes 1.1× the measured refresh interval (`RefreshEstimator`). Otherwise a vsync-bound 60 Hz screen could never step back up.
4. **Renderer** (`scene.ts`). `powerPreference: 'high-performance'`; `antialias: dpr < 1.5`.
5. **Quality tiers.** Start `high`: shadows on, map reduced 2048² → 1024². Drop to `low` once, after ~3 s still > 22 ms at the floor ratio: shadow map off, key light `castShadow` off, materials recompile once. It never goes back.
6. **Frame cap** (`client/src/three/frameCap.ts`).
   - `FrameGate` renders at most every 1000/60 − 2 ms. It keeps a 60 Hz cadence (`last += interval`) instead of measuring from the last render. Measuring from the last render would give 48 fps on 144 Hz and 55 fps on 165 Hz.
   - After a stall it resyncs instead of bursting.
   - Frame callbacks run only on rendered ticks, with the real elapsed dt.
7. **Cheaper materials.**
   - Building, props, shades, board and avatars use `MeshLambertMaterial`. `ZoneDimmer` still scales `.color` (type widened); shade emissive still works; the board texture's `attach` was updated.
   - Lambert vs Standard, with the pool, sync bench: 12–14 ms vs 19–22 ms. So the switch was kept, with the sheen compensation described below.
8. **No per-frame allocations in the camera rig and frame loop.**
   - `CameraRig.follow` reuses `desired/lookAt/head/dir` vectors and a hit array, and caches the seated pose per seat.
   - The scene loop iterates an array instead of a `Set` iterator.
   - `Game.frame` reuses a `dimAt` field and a `promptMe` object.
   - The rain update uses a for-loop, and the preview's occluder list is built once.
   - **Still allocating, outside the rig and loop proper:** `pickPrompt` (filters, a Set), `RemotePlayers.views()`, label text, and three's internal raycast hit objects.
9. **Dev stats overlay** (`client/src/ui/stats.ts`). `?stats=1` shows fps, frame ms (the quality controller's sample), draw calls, triangles, pixel ratio, tier, and active pool lights (point lights with intensity > 0).

## Tests added

43 new tests in 5 files (246 → 289); total 43 files / 289 tests.

- `client/test/lightPool.test.ts` (15):
  - score formula;
  - top-n selection with ties and an out array;
  - slot keep, free and fill;
  - easing over ~250 ms;
  - fade-out before move;
  - re-pick only every 150 ms;
  - following intensity down to 0;
  - `share()`;
  - the three.js binding: exactly 6 always-visible lights, moved and configured.
- `client/test/quality.test.ts` (11): start values; step down; floor; hold band; step up after ~3 s to the cap; failed-step-up back-off; stall ignore; caller fast threshold; tier drop only at the floor; never back to high.
- `client/test/frameCap.test.ts` (9): 165, 144, 120, 60 (with jitter) and 30 Hz cadences; stall resync; refresh estimator min, forgetting and bad input.
- `client/test/glow.test.ts` (5): quad and UV clipping; falloff; one additive, depth-write-off mesh per zone; vertex colour = lamp × surface × level + sheen.
- `client/test/stats.test.ts` (3): the flag, formatting, and DOM.

## Commands and outputs

`npm test` (output has no warnings or stderr):
```
 Test Files  43 passed (43)
      Tests  289 passed (289)
```

`npm run build` (no warnings):
```
> tsc --noEmit -p shared && tsc --noEmit -p server && tsc --noEmit -p client && vite build client
✓ 81 modules transformed.
client/dist/assets/index-D8IkN-A3.js   111.14 kB │ gzip:  40.43 kB
client/dist/assets/three-BL-SLVJ7.js   553.11 kB │ gzip: 136.44 kB
✓ built in 198ms
```

**Preview.**
- Vite ran via the `client-vite` launch config on port 5173, which was free. 3000 wasn't needed.
- The checks used `/preview.html?stats=1`.
- **Before and after images.** For each of 10 states the canvas was captured to a 640×360 image. The states:
  - day: overview, reading, lounge;
  - night: overview, reading, lounge, studyA;
  - night: standing by a desk (F view);
  - seated at desk R10, at night and by day.
- Each before/after pair was compared side by side in the pane and as mean sRGB per grid cell.
- The temporary measurement hooks were removed before the commit. The server was stopped and the pane closed.

## Look differences

Final per-state difference: RMSE of 6×3 grid-cell mean colours, 0–255 sRGB, with the mean R/G/B delta (after − before).

| state | RMSE | mean ΔR/ΔG/ΔB |
|---|---|---|
| day overview | 1.2 | +0.1/−0.7/−1.0 |
| day reading | 3.2 | +1.2/−2.1/−2.0 |
| day lounge | 1.6 | −0.6/−0.9/−1.7 |
| day seated at desk | 5.9 | −0.5/−3.4/−3.4 |
| night overview | 2.7 | +1.1/+0.9/+0.7 |
| night reading | 1.7 | +0.2/+0.7/+1.1 |
| night lounge | 2.9 | −1.9/−1.4/−1.2 |
| night studyA | 2.5 | −1.4/−0.9/−1.3 |
| night by desk | 6.9 | −2.7/−0.7/+1.2 |
| night seated | 5.0 | +0.3/+0.6/+1.9 |

**What still differs, visually:**
- **The near-me close-ups are the largest difference.** Other avatars and partitions next to lamps without a pool light lose their small, sharp warm highlights. Lambert has no specular term, and the fill is uniform per zone, not per partition. My own desk, my avatar and the lamps around me are lit by real lights as before.
- **Lounge floor glows are rounder.** At night, seen from far away (lamps without a pool light), the lounge floor glows read as slightly more defined round pools than the old real lights did.
- **Shadows** are a bit softer and blockier (1024² map). On the `low` tier there are none.
- **No MSAA** at dpr ≥ 1.5 (per spec), so edges are a little more aliased on such screens.
- **Before tuning, the swap was clearly visible.** Pure Lambert with a pool and plain glow was darker and less warm at night: −6 R in the lounge, about half the brightness around lamps on dark surfaces. That came from losing the PBR specular. A glow without albedo tinting was far too bright on floors. The fill, sheen and day-scale terms (`building.ts` constants `GLOW`, `FILL`, `FILL_DAY`, `GLOW_DAY`, `SHEEN`) were fitted against these captures to get the numbers above.

## Concerns / follow-ups

- **No live after-fps from the stats overlay.** The pane was hidden, so the after numbers are from the GPU-throughput bench on the same Intel UHD at 1920×1080. Please glance at `/preview.html?stats=1` with the pane visible to confirm ~60 fps and that the ratio stays at its cap.
- **The adaptive controller's input is a proxy.** The sample is the time from a rendered tick to the next rAF tick, which assumes the browser holds back rAF when the GPU is behind (it does in Chrome). Only the unit tests cover the controller; it was not run against a real slow GPU.
- **The pixel-ratio cap is read once at start.** Moving the window to a monitor with a different DPR keeps the old cap.
- **Spec item 2 was extended.** The lamp fill and sheen were added to keep the approved look. They are cheap (per-material uniforms plus vertex-colour writes), but they are beyond the letter of the spec.
- **The 'low' tier switch is unit-tested only as a decision.** The actual switch (shadow map off plus a recompile) was not triggered in the browser.

## Fix round 1

Review findings 1–7. Most were done test-first; the `dropShadows` and `buildingLights` tests were written alongside the code.

| # | Change | Tests |
|---|---|---|
| 1 | **Thresholds relative to the display refresh.** New pure `qualitySample(q, sampleMs, refreshMs)` in `quality.ts` is the loop's whole sample→threshold wiring (`scene.ts` calls only this). Fast threshold = `max(13, 1.1·refresh)`, slow threshold = `max(22, 1.25·refresh)`. `stepQuality` takes the slow threshold as a parameter. The refresh used is capped at `MAX_REFRESH_MS = 34` (≈30 Hz) so that a GPU-bound display that manages only every 3rd vsync still steps down. | `quality.test.ts` +6: 33.3 ms samples / 33.3 ms refresh → no ratio or tier change for 120 s; 40 and 48 Hz hold; 40 ms / 16.7 ms steps down; a vsync-bound 60 Hz display steps back up; the cap; unknown refresh → absolute thresholds |
| 2 | **Pool hysteresis.** `selectLamps(…, slots)` gives lamps already held by a slot a ×`HELD_BONUS` (1.2) score. `assignSlots` lets a picked lamp reclaim a still-bright slot sitting on it, even one heading to another lamp, so two slots never light one lamp. `share()` sums all slots on a lamp, capped at 1. | `lightPool.test.ts` +5: bonus; reclaim; focus jitter between two equal lamps causes no swap; never two slots on one lamp over a 20 s wandering focus; `share()` sums |
| 3 | **`RefreshEstimator` uses a low percentile.** It now takes the 10th percentile of a 120-tick ring, recomputed every 30 ticks without allocating, instead of the raw minimum. The first estimate comes after 30 ticks (≈1 s at 30 Hz), before the first 1.5 s quality window. | `frameCap.test.ts` +2: one 3 ms outlier among 16.7 ms ticks; 30 Hz read within 30 ticks |
| 4 | **Low tier frees the shadow map.** It is now an exported `dropShadows()`: shadow map off, `castShadow` off, `key.shadow.dispose()` and `map = null`, then every material flagged for recompile. | new `scene.test.ts` (1) |
| 5 | **Integration test.** `buildBuilding` + pool (jsdom, canvas 2D stubbed) under DAY, NIGHT and a dimmed lounge: ≤ 6 point lights, all `visible`; 6 lit by day in the reading room; the 5 lounge lamps take pool lights at night and none by day; `glow:reading` vertex colours scale between f² and f with the dim factor and return on un-dim. | new `buildingLights.test.ts` (3) |
| 6 | **Fewer per-frame allocations.** `RemotePlayers.views()` refills one reused array. `pickPrompt` returns frozen shared constants for stand / focusBlocked / coffee / vending / radio / board. Indexed loops replace `for…of` in `building.ts` update (glows, fills, rain) and in `LightPoolState` (update / share / active / assignSlots). | `interact.test.ts` +1 (same frozen object), new `remotePlayers.test.ts` (1) |
| 7 | **Stats overlay labels.** It stays behind `?stats=1` in production and now shows `render fps` (1000 / mean interval between rendered frames), `raf fps` (ticks per second) and `tick ms` (the controller's sample). | `stats.test.ts` +1 (`renderFps`), formatting updated |

**Commands:**
```
npm test       → Test Files 46 passed (46) · Tests 309 passed (309)   (no warnings/stderr)
npm run build  → tsc shared/server/client clean; vite: ✓ 81 modules transformed … ✓ built in 166ms (no warnings)
```

**Preview.** The page was already open at `/preview.html?stats=1` (the dev server and tab were already running; I didn't start or stop them) and reloaded with the new code: no console errors. Overlay (pane hidden, throttled): `render fps 4 | raf fps 7 | tick 257.5 ms | calls 188 | tris 158.7k | ratio 1.00 | tier high | lights 6`. The throttled ~250 ms+ ticks are ignored by the controller.

**Remaining trade-offs:**
- rAF timing alone can't tell a 30–34 Hz display from a 60 Hz GPU that consistently needs exactly 2 vsyncs per frame. In the second case the controller now holds instead of stepping down. The p10 estimator still finds 16.7 ms whenever ≥ 10 % of ticks land on a single vsync, so only perfectly steady 2-vsync rendering is affected.
- Still allocating per frame: `pickPrompt`'s `filter`s / `Set` and `Map` iterators in `RemotePlayers`.

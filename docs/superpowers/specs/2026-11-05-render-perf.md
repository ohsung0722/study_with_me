# Render performance pass (v1.1)

Goal: Studyverse runs smoothly (target ≥ 50 fps at 1080p-class windows) on a laptop with only integrated graphics (e.g. Intel UHD), while keeping the approved look (warm desk lamps, night lofi, zone dimming) visually close to today.

## Measured / known causes
- Up to 31 real `THREE.PointLight`s (24 desk lamps whenever the theme's `lampI > 0` — including the DAY theme — plus 5 lounge lamps and 2 study-room pendants at night). three.js forward shading evaluates every light for every lit fragment.
- `renderer.setPixelRatio(min(devicePixelRatio, 2))` + MSAA on a 2560×1600 screen → ~4 M fragments per frame.
- Lights toggled with `.visible` change the shader light count → program recompiles (hitch at day/night switch).
- 2048² shadow map; MeshStandardMaterial (PBR) on everything; render loop runs at the monitor rate (165 Hz here).
- Browser defaults to the integrated GPU on hybrid laptops (renderer doesn't request high performance).

## Required changes
1. **Light pool.** A fixed pool of `LIGHT_POOL_SIZE = 6` PointLights, created once, always `visible = true` (never toggle visibility; unused slots get intensity 0). Every ~150 ms pick the lamp sources with the highest contribution at the camera's focus point (my avatar) — score ≈ source intensity × zone dim factor / (1 + distance²) — from: desk lamps (when `lampI > 0`), lounge lamps and study-room pendants (at night). Move pool lights to those sources and ease each slot's intensity toward its target over ~250 ms so lamps don't pop. The pool lives in its own module (`client/src/three/lightPool.ts`) with the selection logic as a pure, unit-tested function.
2. **Fake glow for every lamp.** Keep the emissive shades. Add a soft warm light pool on the surface under each lamp (desk tops for desk lamps, floor/table for lounge lamps and pendants): an additive-blended, depth-write-off radial-gradient quad (one shared CanvasTexture), merged per zone (or an InstancedMesh per zone) so it costs a handful of draw calls. Its strength follows the same values the real lights used (lampI / night × zone dim factor).
3. **Resolution.** Pixel ratio cap 1.5. Adaptive resolution: track average frame time over ~1.5 s; if > 22 ms, step pixel ratio down (×0.85, floor 0.6); if < 13 ms for ~3 s, step back up (to the cap). Hysteresis so it doesn't oscillate. Pure controller function, unit-tested.
4. **Renderer.** `powerPreference: 'high-performance'`. `antialias` only when `devicePixelRatio < 1.5`.
5. **Quality tiers.** `high` (shadows on, 1024² map) and `low` (shadows off). Start at `high`; drop to `low` once if, even at the minimum pixel ratio, frame time stays > 22 ms for ~3 s (one-time recompile is acceptable). Never flip back automatically during a session.
6. **Frame cap.** Render at most ~60 fps (skip rAF ticks that come sooner than 1000/60 ms minus a small tolerance); game logic still uses real dt.
7. **Cheaper materials.** Static building/props and avatars may move from `MeshStandardMaterial` to `MeshLambertMaterial` if the look stays close (zone dimming via `ZoneDimmer` must keep working — it scales `.color`; emissive behavior must keep working for shades).
8. **No per-frame allocations** in the camera rig and frame loop (reuse vectors).
9. **Dev stats overlay**: `?stats=1` shows fps, frame ms, draw calls, triangles, pixel ratio, tier, active pool lights.

## Acceptance
- At most 6 PointLights exist in the scene (plus ambient + directional), regardless of theme and player count.
- No `.visible` toggling of lights anywhere.
- Day/night and zone dimming look close to before (compare in `/preview.html`), desk lamps near me still light the desk/avatar, far lamps still glow.
- All existing tests pass; new pure functions (light selection, adaptive resolution, frame cap gate) are unit-tested; `npm run build` clean.

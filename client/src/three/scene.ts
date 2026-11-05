// Renderer, scene, camera, global lights and the requestAnimationFrame loop.
// Performance: renders at most ~60 fps (FrameGate), adapts the pixel ratio to the measured frame time and drops
// shadows once if even the lowest ratio is too slow (quality.ts). `?stats=1` shows a stats overlay.
import * as THREE from 'three';
import { MAP } from '@studyverse/shared';
import type { Theme } from './theme';
import { FrameGate, RefreshEstimator, refreshReference } from './frameCap';
import { initialQuality, qualitySample, type Tier } from './quality';
import { StatsOverlay, renderFps, statsEnabled } from '../ui/stats';

export type FrameCallback = (dtMs: number, nowMs: number) => void;

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Background, ambient and key light colours/intensities. Building materials: see buildBuilding().applyTheme. */
  applyTheme(t: Theme): void;
  /** Register a per-frame callback (runs before render); returns an unsubscribe function. */
  onFrame(cb: FrameCallback): () => void;
  start(): void;
  stop(): void;
  dispose(): void;
}

const MAX_DT_MS = 100;        // a stalled/hidden tab must not produce a huge step
const SHADOW_MAP_SIZE = 1024; // 'high' tier; 'low' has no shadows
const STATS_MS = 500;

/**
 * The 'low' tier: shadows off for good. Disables the shadow map, stops the key light casting, frees its shadow map
 * render target and flags every material for its one-time recompile.
 */
export function dropShadows(shadowMap: { enabled: boolean }, key: THREE.DirectionalLight, scene: THREE.Object3D): void {
  shadowMap.enabled = false;
  key.castShadow = false;
  key.shadow.dispose();
  key.shadow.map = null;
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
  });
}

export interface SceneOptions {
  /**
   * Display refresh interval measured before any WebGL work (measureRefresh); the quality controller's fixed
   * reference. 0/absent (e.g. preview.html): the in-loop estimate stands in.
   */
  refreshMs?: number;
}

export function createScene(container: HTMLElement, opts: SceneOptions = {}): SceneCtx {
  const premeasuredRefresh = opts.refreshMs ?? 0;
  const dpr = window.devicePixelRatio || 1;
  const quality = initialQuality(dpr);
  // MSAA only where pixels are big enough for jaggies to show; high-res screens get the resolution instead.
  const renderer = new THREE.WebGLRenderer({ antialias: dpr < 1.5, powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.ratio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

  const cx = MAP.width / 2, cz = MAP.depth / 2;
  const amb = new THREE.AmbientLight();
  const key = new THREE.DirectionalLight();
  key.position.set(cx + 8, 18, cz + 12);
  key.target.position.set(cx, 0, cz);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 70 }); // 45 × 37 m building
  scene.add(amb, key, key.target);

  const applyTier = (tier: Tier) => {
    if (tier === 'low') dropShadows(renderer.shadowMap, key, scene);
  };

  const resize = () => {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // ---------- stats overlay (?stats=1) ----------
  const overlay = statsEnabled(location.search) ? new StatsOverlay(document.body) : null;
  let statFrom = 0, statTicks = 0, statWorkSum = 0, statWorkN = 0, statRenderSum = 0, statRenderN = 0, lastRendered = 0;
  const countLights = () => {
    let n = 0;
    scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight && (o as THREE.PointLight).intensity > 0) n++; });
    return n;
  };
  /** Called after each render. */
  const showStats = (now: number) => {
    if (!overlay) return;
    if (lastRendered) { statRenderSum += now - lastRendered; statRenderN++; }
    lastRendered = now;
    if (!statFrom) statFrom = now;
    if (now - statFrom < STATS_MS) return;
    overlay.show({
      renderFps: renderFps(statRenderSum, statRenderN), rafFps: (statTicks * 1000) / (now - statFrom),
      tickMs: statWorkN ? statWorkSum / statWorkN : 0,
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      pixelRatio: renderer.getPixelRatio(), tier: quality.tier, lights: countLights(),
    });
    statFrom = now;
    statTicks = statWorkSum = statWorkN = statRenderSum = statRenderN = 0;
  };

  // ---------- loop ----------
  const callbacks: FrameCallback[] = [];
  const gate = new FrameGate();
  const refresh = new RefreshEstimator();
  let raf = 0;
  let last = 0;          // last rendered tick (for dt)
  let lastTick = 0;      // last rAF tick (for the refresh estimate)
  let renderedAt = -1;   // rendered tick waiting for its frame-time sample
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (lastTick) refresh.observe(now - lastTick);
    lastTick = now;
    statTicks++;
    // Tick sample = from a rendered tick to the next tick: our work plus however long the browser/GPU held the
    // next frame back. Thresholds are relative to the display refresh, so being vsync-bound never counts as slow.
    if (renderedAt >= 0) {
      const sample = now - renderedAt;
      renderedAt = -1;
      statWorkSum += sample;
      statWorkN++;
      if (!document.hidden) {
        const change = qualitySample(quality, sample, refreshReference(premeasuredRefresh, refresh.value()));
        if (change === 'ratio') renderer.setPixelRatio(quality.ratio);
        else if (change === 'tier') applyTier(quality.tier);
      }
    }
    if (!gate.shouldRender(now)) return;
    const dt = last ? Math.min(MAX_DT_MS, now - last) : 0;
    last = now;
    for (let i = 0; i < callbacks.length; i++) callbacks[i](dt, now);
    renderer.render(scene, camera);
    renderedAt = now;
    showStats(now);
  };

  return {
    renderer, scene, camera,
    applyTheme(t) {
      (scene.background as THREE.Color).setHex(t.bg);
      amb.color.setHex(t.ambC);
      amb.intensity = t.ambI;
      key.color.setHex(t.keyC);
      key.intensity = t.keyI;
    },
    onFrame(cb) {
      callbacks.push(cb);
      return () => {
        const i = callbacks.indexOf(cb);
        if (i >= 0) callbacks.splice(i, 1);
      };
    },
    start() {
      if (raf) return;
      last = lastTick = lastRendered = 0;
      renderedAt = -1;
      gate.reset();
      raf = requestAnimationFrame(loop);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    dispose() {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      callbacks.length = 0;
      overlay?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

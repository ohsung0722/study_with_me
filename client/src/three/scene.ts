// Renderer, scene, camera, global lights and the requestAnimationFrame loop.
import * as THREE from 'three';
import { MAP } from '@studyverse/shared';
import type { Theme } from './theme';

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

const MAX_DT_MS = 100; // a stalled/hidden tab must not produce a huge step

export function createScene(container: HTMLElement): SceneCtx {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 60 });
  scene.add(amb, key, key.target);

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

  const callbacks = new Set<FrameCallback>();
  let raf = 0;
  let last = 0;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(MAX_DT_MS, now - last) : 0;
    last = now;
    for (const cb of callbacks) cb(dt, now);
    renderer.render(scene, camera);
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
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    start() {
      if (raf) return;
      last = 0;
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
      callbacks.clear();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

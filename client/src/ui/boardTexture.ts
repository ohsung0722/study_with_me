// Record board: today's summary + TOP 5, drawn onto a canvas used as the 'board' mesh's texture.
// Nicknames are drawn with fillText only.
import * as THREE from 'three';
import type { TodayStats } from '@studyverse/shared';
import { formatHoursMinutes, formatTotalHours } from './format';

export function boardSummary(s: TodayStats): string {
  return `오늘 ${s.people}명 · 총 ${formatTotalHours(s.totalSec)}시간`;
}

const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
const INK = '#4a3b2e', ACCENT = '#b9702f', MUTED = '#8a7660';
const MEDALS = ['#d9a441', '#9aa3ad', '#b87a4b'];

/** Shortens `text` with '…' until it fits `max` px in the current font. */
function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  const cps = [...text];
  while (cps.length > 1 && g.measureText(`${cps.join('')}…`).width > max) cps.pop();
  return `${cps.join('')}…`;
}

/** Draws the board onto a w×h 2D context (designed for ~768×496, the board's 1.7:1.1 aspect). */
export function drawBoard(g: CanvasRenderingContext2D, w: number, h: number, s: TodayStats): void {
  const u = h / 496;
  g.fillStyle = '#fbf6ea';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e6d8c0';
  g.lineWidth = 6 * u;
  g.strokeRect(10 * u, 10 * u, w - 20 * u, h - 20 * u);

  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = ACCENT;
  g.font = `bold ${30 * u}px ${FONT}`;
  g.fillText('오늘의 기록판', 40 * u, 52 * u);
  g.fillStyle = INK;
  g.font = `bold ${40 * u}px ${FONT}`;
  g.fillText(boardSummary(s), 40 * u, 104 * u);

  g.fillStyle = '#e6d8c0';
  g.fillRect(40 * u, 140 * u, w - 80 * u, 3 * u);

  const rows = s.top5.slice(0, 5);
  if (rows.length === 0) {
    g.fillStyle = MUTED;
    g.font = `${30 * u}px ${FONT}`;
    g.fillText('아직 기록이 없어요', 40 * u, 230 * u);
    return;
  }
  rows.forEach((r, i) => {
    const y = 182 * u + i * 62 * u;
    g.fillStyle = MEDALS[i] ?? '#e6d8c0';
    g.beginPath();
    g.arc(62 * u, y, 20 * u, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = i < 3 ? '#fff' : INK;
    g.font = `bold ${24 * u}px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(String(i + 1), 62 * u, y + 1 * u);

    g.textAlign = 'right';
    g.fillStyle = MUTED;
    g.font = `${28 * u}px ${FONT}`;
    const time = formatHoursMinutes(r.sec);
    g.fillText(time, w - 44 * u, y);

    g.textAlign = 'left';
    g.fillStyle = INK;
    g.font = `bold ${30 * u}px ${FONT}`;
    g.fillText(fit(g, r.nickname, w - 340 * u), 100 * u, y);
  });
}

/** Canvas texture for the board face; redraws only when the stats change. */
export class BoardTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private key = '';

  constructor(width = 768, height = 496) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  update(s: TodayStats): void {
    const key = JSON.stringify(s);
    if (key === this.key) return;
    const g = this.canvas.getContext('2d');
    if (!g) return;
    this.key = key;
    drawBoard(g, this.canvas.width, this.canvas.height, s);
    this.texture.needsUpdate = true;
  }

  /** Puts the texture on the board mesh (named 'board' in building.ts). Colour stays with the zone dimmer. */
  attach(mesh: THREE.Mesh): void {
    const m = mesh.material as THREE.MeshLambertMaterial;
    m.map = this.texture;
    m.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

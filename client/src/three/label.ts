// Name/status labels above avatars: pure text logic + a canvas-texture sprite (style from the focus-dim mockup).
import * as THREE from 'three';
import { formatHMS, formatMS, type PlayerView } from '@studyverse/shared';

export type LabelStyle = 'normal' | 'me' | 'npc' | 'focus';

/** Label text for a player. All times come from `serverNow` (server clock), never the local clock. */
export function labelText(v: PlayerView, serverNow: number, isMe = false): { text: string; style: LabelStyle } {
  const s = v.status;
  if (v.isNpc) {
    const text = s.kind === 'studying' ? `메이트 ${formatHMS((serverNow - s.startedAt) / 1000)}` : '메이트';
    return { text, style: 'npc' };
  }
  if (s.kind === 'studying') {
    return {
      text: `${s.focus ? '🔒 ' : ''}${v.nickname} ${formatHMS((serverNow - s.startedAt) / 1000)}`,
      style: isMe ? 'me' : s.focus ? 'focus' : 'normal',
    };
  }
  const style: LabelStyle = isMe ? 'me' : 'normal';
  if (s.kind === 'break') return { text: `${v.nickname} 휴식 ${formatMS((s.endsAt - serverNow) / 1000)}`, style };
  return { text: v.nickname, style };
}

const STYLE_BG: Record<LabelStyle, string> = {
  normal: 'rgba(20,20,30,0.78)',
  me: 'rgba(40,120,200,0.9)',
  npc: 'rgba(124,92,255,0.92)',
  focus: 'rgba(20,20,30,0.78)',
};
const STYLE_FG: Record<LabelStyle, string> = { normal: '#fff', me: '#fff', npc: '#fff', focus: '#ffe2a8' };

const W = 320, H = 72, PAD = 22, FONT_PX = 28;
const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

/** Billboard label. Put `object` where it should float (≈2 m above the avatar's feet). */
export class LabelSprite {
  readonly object: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private tex: THREE.CanvasTexture;
  private material: THREE.SpriteMaterial;
  private key = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true });
    this.object = new THREE.Sprite(this.material);
    this.object.scale.set(1.5, 0.34, 1);
    this.object.renderOrder = 10;
  }

  /** Redraws only when text or style changed. */
  set(text: string, style: string): void {
    const key = `${style}\u0000${text}`;
    if (key === this.key) return;
    this.key = key;
    const st: LabelStyle = style in STYLE_BG ? (style as LabelStyle) : 'normal';
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, W, H);
    g.fillStyle = STYLE_BG[st];
    g.beginPath();
    g.roundRect(6, 8, W - 12, 56, 28);
    g.fill();
    let px = FONT_PX;
    g.font = `bold ${px}px ${FONT}`;
    while (px > 14 && g.measureText(text).width > W - 2 * PAD) {
      px -= 2;
      g.font = `bold ${px}px ${FONT}`;
    }
    g.fillStyle = STYLE_FG[st];
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, W / 2, 37);
    this.tex.needsUpdate = true;
  }

  setOpacity(o: number): void {
    this.material.opacity = o;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.tex.dispose();
    this.material.dispose();
  }
}

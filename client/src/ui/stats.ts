// Dev stats overlay (?stats=1): fps, frame time, draw calls, triangles, pixel ratio, quality tier, active pool lights.
export interface StatsSample {
  fps: number;
  frameMs: number;
  calls: number;
  triangles: number;
  pixelRatio: number;
  tier: string;
  lights: number;
}

export function statsEnabled(search: string): boolean {
  return new URLSearchParams(search).get('stats') === '1';
}

export function formatStats(s: StatsSample): string {
  return [
    `fps ${Math.round(s.fps)}`,
    `frame ${s.frameMs.toFixed(1)} ms`,
    `calls ${s.calls}`,
    `tris ${(s.triangles / 1000).toFixed(1)}k`,
    `ratio ${s.pixelRatio.toFixed(2)}`,
    `tier ${s.tier}`,
    `lights ${s.lights}`,
  ].join('\n');
}

export class StatsOverlay {
  private el: HTMLPreElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.className = 'stats-overlay';
    Object.assign(this.el.style, {
      position: 'fixed', right: '8px', top: '8px', margin: '0', padding: '6px 9px', zIndex: '9999',
      font: '12px/1.45 ui-monospace, Consolas, monospace', color: '#cfe', background: 'rgba(0,0,0,.66)',
      borderRadius: '6px', pointerEvents: 'none',
    });
    parent.appendChild(this.el);
  }

  show(s: StatsSample): void {
    this.el.textContent = formatStats(s);
  }

  dispose(): void {
    this.el.remove();
  }
}

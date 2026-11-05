// Stats overlay (?stats=1, also in production for field diagnostics): render fps (from the time between rendered
// frames), rAF fps (ticks per second), the quality controller's tick sample, draw calls, triangles, pixel ratio,
// quality tier and active pool lights.
export interface StatsSample {
  renderFps: number;
  rafFps: number;
  tickMs: number;   // the adaptive-quality sample: rendered tick → next rAF tick
  calls: number;
  triangles: number;
  pixelRatio: number;
  tier: string;
  lights: number;
}

export function statsEnabled(search: string): boolean {
  return new URLSearchParams(search).get('stats') === '1';
}

/** Frames per second from the summed intervals between `n` consecutive rendered frames. */
export function renderFps(intervalSumMs: number, n: number): number {
  return n > 0 && intervalSumMs > 0 ? (1000 * n) / intervalSumMs : 0;
}

export function formatStats(s: StatsSample): string {
  return [
    `render fps ${Math.round(s.renderFps)}`,
    `raf fps ${Math.round(s.rafFps)}`,
    `tick ${s.tickMs.toFixed(1)} ms`,
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

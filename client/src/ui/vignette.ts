// Focus-mode vignette: screen edges darken around my avatar (radial-gradient, as in the focus-dim mockup).
import { OTHER_ZONE_BRIGHTNESS } from '@studyverse/shared';

// Same darkness formula as the mockup: (1 - dim) * 0.9 + 0.1 with dim = other-zone brightness.
const EDGE_ALPHA = ((1 - OTHER_ZONE_BRIGHTNESS) * 0.9 + 0.1).toFixed(3);

export class Vignette {
  private el: HTMLDivElement;
  private center = '';

  constructor(root: HTMLElement) {
    this.el = root.ownerDocument.createElement('div');
    this.el.className = 'vignette';
    this.el.setAttribute('aria-hidden', 'true');
    root.appendChild(this.el);
    this.setCenter(50, 55);
  }

  setActive(on: boolean): void {
    this.el.classList.toggle('active', on);
  }

  /** Clear centre in viewport percent (e.g. my avatar projected to screen). */
  setCenter(xPct: number, yPct: number): void {
    const key = `${xPct.toFixed(1)}% ${yPct.toFixed(1)}%`;
    if (key === this.center) return;
    this.center = key;
    this.el.style.background =
      `radial-gradient(circle at ${key}, rgba(0,0,0,0) 0, rgba(0,0,0,0) 18vmin, rgba(10,6,2,${EDGE_ALPHA}) 58vmin)`;
  }

  dispose(): void {
    this.el.remove();
  }
}

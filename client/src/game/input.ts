// Keyboard state. Uses KeyboardEvent.code (layout independent).
const FORWARD = ['KeyW', 'ArrowUp'], BACK = ['KeyS', 'ArrowDown'], LEFT = ['KeyA', 'ArrowLeft'], RIGHT = ['KeyD', 'ArrowRight'];

export class InputState {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  private doc: (EventTarget & { hidden?: boolean }) | undefined;

  constructor(private target: Window) {
    target.addEventListener('keydown', this.onDown as EventListener);
    target.addEventListener('keyup', this.onUp as EventListener);
    target.addEventListener('blur', this.clear);
    this.doc = (target as unknown as { document?: Document }).document ?? (typeof document !== 'undefined' ? document : undefined);
    this.doc?.addEventListener('visibilitychange', this.onVis);
  }

  private onDown = (e: KeyboardEvent) => {
    if (!this.keys.has(e.code)) this.pressed.add(e.code); // ignore auto-repeat
    this.keys.add(e.code);
  };
  private onUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private clear = () => { this.keys.clear(); this.pressed.clear(); };
  private onVis = () => { if (this.doc?.hidden) this.clear(); };

  /** Input space: x = right (+) / left (-), z = forward (+) / back (-). */
  axis(): { x: number; z: number } {
    const on = (codes: string[]) => (codes.some(c => this.keys.has(c)) ? 1 : 0);
    return { x: on(RIGHT) - on(LEFT), z: on(FORWARD) - on(BACK) };
  }

  /** True once per physical key press. */
  consumePressed(code: string): boolean {
    return this.pressed.delete(code);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown as EventListener);
    this.target.removeEventListener('keyup', this.onUp as EventListener);
    this.target.removeEventListener('blur', this.clear);
    this.doc?.removeEventListener('visibilitychange', this.onVis);
  }
}

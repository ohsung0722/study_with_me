// Heads-up display: status pills (top-left), the E prompt (bottom-centre) and toasts (top-right).
// Everything is written with textContent; toast parts may carry user nicknames.
import { formatHMS, formatMS, type ZoneId } from '@studyverse/shared';
import type { Prompt } from '../game/interact';

export const ZONE_NAMES: Record<ZoneId, string> = {
  lounge: '라운지', cafe: '카페', corridor: '복도', hallW: '복도', hallE: '복도', reading: '열람실 A', readingB: '열람실 B',
  studyA: '스터디룸 A', studyB: '스터디룸 B', studyC: '스터디룸 C', studyD: '스터디룸 D',
};

const MAX_TOASTS = 3;
const TOAST_FADE_MS = 300;

function div(cls: string, parent: HTMLElement): HTMLDivElement {
  const d = parent.ownerDocument.createElement('div');
  d.className = cls;
  parent.appendChild(d);
  return d;
}

/** Sets text and visibility (hidden pills are emptied); touches the DOM only on change. */
function setPill(el: HTMLElement, text: string | null): void {
  if (el.hidden !== (text === null)) el.hidden = text === null;
  const want = text ?? '';
  if (el.textContent !== want) el.textContent = want;
}

export class Hud {
  private layer: HTMLDivElement;
  private zone: HTMLDivElement;
  private focus: HTMLDivElement;
  private today: HTMLDivElement;
  private breakLeft: HTMLDivElement;
  private prompt: HTMLDivElement;
  private promptKey = '';
  private toasts: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.layer = div('hud-layer', root);
    const stack = div('hud-stack', this.layer);
    this.zone = div('hud-pill', stack);
    this.focus = div('hud-pill hud-focus', stack);
    this.today = div('hud-pill', stack);
    this.breakLeft = div('hud-pill hud-break', stack);
    for (const p of [this.zone, this.focus, this.today, this.breakLeft]) p.hidden = true;
    this.prompt = div('hud-prompt', this.layer);
    this.prompt.hidden = true;
    this.toasts = div('hud-toasts', this.layer);
    this.toasts.setAttribute('aria-live', 'polite');
  }

  setZone(z: ZoneId | null): void {
    setPill(this.zone, z ? `📍 ${ZONE_NAMES[z]}` : null);
  }

  setFocus(on: boolean): void {
    setPill(this.focus, on ? '🔒 집중 모드 · 인사를 받지 않아요' : null);
  }

  /** My study time today (seconds, already including the live session). */
  setMyToday(sec: number): void {
    setPill(this.today, `📚 오늘 ${formatHMS(sec)}`);
  }

  /** Break time left in seconds; null hides it. */
  setBreakLeft(sec: number | null): void {
    setPill(this.breakLeft, sec === null ? null : `☕ 휴식 ${formatMS(sec)}`);
  }

  /** The E prompt, with an optional second line (e.g. the seat's study time today). */
  setPrompt(p: Prompt | null, note: string | null = null): void {
    const key = p ? `${p.text}\u0000${note ?? ''}` : '';
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.prompt.replaceChildren();
    this.prompt.hidden = !p;
    if (!p) return;
    const doc = this.prompt.ownerDocument;
    const line = div('hud-prompt-main', this.prompt);
    if (p.text.startsWith('E ')) {
      const kbd = doc.createElement('kbd');
      kbd.textContent = 'E';
      line.append(kbd, doc.createTextNode(p.text.slice(1)));
    } else {
      line.textContent = p.text;
    }
    if (note) div('hud-prompt-note', this.prompt).textContent = note;
  }

  /** Toast for `ms`. Strings are plain text; `{ strong }` parts are bold (still text). Returns a dismiss handle. */
  toast(parts: (string | { strong: string })[], ms: number, action?: { label: string; onClick(): void }): () => void {
    const doc = this.toasts.ownerDocument;
    const t = div('hud-toast', this.toasts);
    const body = div('hud-toast-text', t);
    for (const part of parts) {
      if (typeof part === 'string') {
        body.appendChild(doc.createTextNode(part));
      } else {
        const b = doc.createElement('strong');
        b.textContent = part.strong;
        body.appendChild(b);
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dismiss = () => {
      if (t.classList.contains('leaving')) return;
      clearTimeout(timer);
      t.classList.add('leaving');
      setTimeout(() => t.remove(), TOAST_FADE_MS);
    };
    if (action) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-toast-btn';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        if (t.classList.contains('leaving')) return;
        action.onClick();
        dismiss();
      });
      t.appendChild(btn);
    }
    timer = setTimeout(dismiss, ms);
    const live = [...this.toasts.children].filter(c => !c.classList.contains('leaving'));
    if (live.length > MAX_TOASTS) live[0].remove();
    return dismiss;
  }

  dispose(): void {
    this.layer.remove();
  }
}

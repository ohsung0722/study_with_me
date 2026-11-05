// Lounge overlays: drink menus, radio menu, record-board panel, break-minutes picker.
// Callbacks only (no socket). One overlay at a time; Esc closes; number keys 1–N pick a menu item.
import { BREAK_MINUTES_OPTIONS, DRINKS, formatHMS, type DrinkId, type TodayStats } from '@studyverse/shared';
import type { RadioKind } from '../audio/radio';
import { boardSummary } from './boardTexture';
import { formatHoursMinutes } from './format';

export const DRINK_NAMES: Record<DrinkId, string> = {
  americano: '아메리카노', latte: '라떼', greenTea: '녹차', ionDrink: '이온음료',
};
const DRINK_ICONS: Record<DrinkId, string> = { americano: '☕', latte: '🥛', greenTea: '🍵', ionDrink: '🥤' };
const MACHINE_TITLES = { coffee: '☕ 커피 머신', vending: '🥤 자판기' } as const;

export const RADIO_NAMES: Record<RadioKind, string> = { lofi: '🎵 로파이', rain: '🌧️ 빗소리', cafe: '☕ 카페 소음', off: '🔇 끄기' };
const RADIO_ORDER: RadioKind[] = ['lofi', 'rain', 'cafe', 'off'];

type BreakMinutes = typeof BREAK_MINUTES_OPTIONS[number];
interface MenuItem { label: string; current?: boolean; pick(): void }

export class LoungeUi {
  private doc: Document;
  private win: Window;
  private panel: HTMLDivElement | null = null;
  private items: MenuItem[] = [];
  private picker: HTMLDivElement | null = null;

  constructor(private root: HTMLElement) {
    this.doc = root.ownerDocument;
    this.win = this.doc.defaultView!;
    this.win.addEventListener('keydown', this.onKey);
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = this.doc.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.panel) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const item = this.items[Number(e.key) - 1];
      if (!item) return;
      e.preventDefault();
      this.close();
      item.pick();
    }
  };

  isOpen(): boolean {
    return this.panel !== null;
  }

  close(): void {
    this.panel?.remove();
    this.panel = null;
    this.items = [];
  }

  private openPanel(title: string, cls = ''): HTMLDivElement {
    this.close();
    const panel = this.el('div', `lounge-panel ${cls}`.trim());
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', title);
    panel.appendChild(this.el('div', 'lounge-title', title));
    this.root.appendChild(panel);
    this.panel = panel;
    return panel;
  }

  private openMenu(title: string, items: MenuItem[]): void {
    const panel = this.openPanel(title);
    const list = this.el('div', 'lounge-items');
    items.forEach((it, i) => {
      const b = this.el('button', `lounge-item${it.current ? ' current' : ''}`);
      b.type = 'button';
      if (it.current) b.setAttribute('aria-current', 'true');
      b.append(this.el('kbd', 'lounge-key', String(i + 1)), this.el('span', 'lounge-label', it.label));
      b.addEventListener('click', () => { this.close(); it.pick(); });
      list.appendChild(b);
    });
    panel.append(list, this.el('div', 'lounge-hint', '숫자 키로 고르기 · Esc 닫기'));
    this.items = items;
  }

  openDrinkMenu(machine: 'coffee' | 'vending', onPick: (d: DrinkId) => void): void {
    this.openMenu(MACHINE_TITLES[machine], DRINKS[machine].map((d) => ({
      label: `${DRINK_ICONS[d]} ${DRINK_NAMES[d]}`, pick: () => onPick(d),
    })));
  }

  openRadioMenu(current: RadioKind, onPick: (k: RadioKind) => void): void {
    this.openMenu('📻 배경음', RADIO_ORDER.map((k) => ({
      label: RADIO_NAMES[k], current: k === current, pick: () => onPick(k),
    })));
  }

  openBoard(stats: TodayStats): void {
    const panel = this.openPanel('📋 오늘의 기록판', 'lounge-board');
    panel.appendChild(this.el('div', 'board-summary', boardSummary(stats)));
    if (stats.top5.length === 0) {
      panel.appendChild(this.el('div', 'board-empty', '아직 기록이 없어요'));
    } else {
      const ol = this.el('ol', 'board-list');
      stats.top5.slice(0, 5).forEach((r, i) => {
        const li = this.el('li', 'board-row');
        li.append(
          this.el('span', `board-rank rank-${i + 1}`, String(i + 1)),
          this.el('span', 'board-nick', r.nickname),
          this.el('span', 'board-time', formatHoursMinutes(r.sec)),
        );
        li.title = formatHMS(r.sec);
        ol.appendChild(li);
      });
      panel.appendChild(ol);
    }
    const close = this.el('button', 'lounge-close', '닫기 (Esc)');
    close.type = 'button';
    close.addEventListener('click', () => this.close());
    panel.appendChild(close);
  }

  /** Persistent "휴식 시간 5분/10분/15분" chips (shown while in the lounge). */
  showBreakPicker(current: BreakMinutes, onPick: (m: BreakMinutes) => void): void {
    this.hideBreakPicker();
    const wrap = this.el('div', 'break-picker');
    wrap.appendChild(this.el('span', 'break-picker-label', '휴식 시간'));
    const buttons = BREAK_MINUTES_OPTIONS.map((m) => {
      const b = this.el('button', 'break-chip', `${m}분`);
      b.type = 'button';
      b.addEventListener('click', () => {
        mark(m);
        b.blur(); // keep keyboard focus off the chip so Space/E don't re-trigger it
        onPick(m);
      });
      wrap.appendChild(b);
      return b;
    });
    const mark = (m: BreakMinutes) =>
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(BREAK_MINUTES_OPTIONS[i] === m)));
    mark(current);
    this.root.appendChild(wrap);
    this.picker = wrap;
  }

  hideBreakPicker(): void {
    this.picker?.remove();
    this.picker = null;
  }

  dispose(): void {
    this.close();
    this.hideBreakPicker();
    this.win.removeEventListener('keydown', this.onKey);
  }
}

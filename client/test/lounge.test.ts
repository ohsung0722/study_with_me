// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LoungeUi } from '../src/ui/lounge';

let root: HTMLElement;
let ui: LoungeUi;
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  ui = new LoungeUi(root);
});
afterEach(() => {
  ui.dispose();
  root.remove();
});

describe('LoungeUi', () => {
  test('coffee machine menu: number key picks, then closes', () => {
    const onPick = vi.fn();
    ui.openDrinkMenu('coffee', onPick);
    expect(ui.isOpen()).toBe(true);
    expect(root.textContent).toContain('아메리카노');
    expect(root.textContent).toContain('라떼');
    expect(root.textContent).not.toContain('녹차');
    key('2');
    expect(onPick).toHaveBeenCalledWith('latte');
    expect(ui.isOpen()).toBe(false);
  });

  test('vending menu: click picks; out-of-range number key is ignored; Esc closes', () => {
    const onPick = vi.fn();
    ui.openDrinkMenu('vending', onPick);
    expect(root.textContent).toContain('녹차');
    expect(root.textContent).toContain('이온음료');
    key('3');
    expect(onPick).not.toHaveBeenCalled();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('이온음료'))!.click();
    expect(onPick).toHaveBeenCalledWith('ionDrink');

    ui.openDrinkMenu('vending', onPick);
    key('Escape');
    expect(ui.isOpen()).toBe(false);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  test('radio menu marks the current choice and picks with 1–4', () => {
    const onPick = vi.fn();
    ui.openRadioMenu('rain', onPick);
    const current = root.querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain('빗소리');
    key('4');
    expect(onPick).toHaveBeenCalledWith('off');
  });

  test('board panel shows the summary and TOP 5 with nicknames as text', () => {
    const evil = '<img src=x onerror=alert(1)>';
    ui.openBoard({ dayKey: '2026-11-05', people: 7, totalSec: 5400 * 4, top5: [{ nickname: evil, sec: 3900 }, { nickname: '지우', sec: 600 }] });
    expect(root.textContent).toContain('오늘 7명 · 총 6시간');
    expect(root.textContent).toContain(evil);
    expect(root.textContent).toContain('1시간 5분');
    expect(root.querySelector('img')).toBeNull();
    ui.close();
    expect(root.textContent).not.toContain('오늘 7명');
  });

  test('break-minutes picker: highlights current, click sends minutes', () => {
    const onPick = vi.fn();
    ui.showBreakPicker(10, onPick);
    const btns = [...root.querySelectorAll('button')];
    expect(btns.map((b) => b.textContent)).toEqual(['5분', '10분', '15분']);
    expect(btns[1].getAttribute('aria-pressed')).toBe('true');
    btns[2].click();
    expect(onPick).toHaveBeenCalledWith(15);
    expect(btns[2].getAttribute('aria-pressed')).toBe('true');
    ui.hideBreakPicker();
    expect(root.textContent).not.toContain('15분');
  });
});

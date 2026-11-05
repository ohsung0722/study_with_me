// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hud } from '../src/ui/hud';

let root: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  root.remove();
  vi.useRealTimers();
});

describe('Hud', () => {
  test('Hud.toast renders nickname as text (no HTML injection)', () => {
    const hud = new Hud(root);
    const evil = '<img src=x onerror=alert(1)>';
    hud.toast([{ strong: evil }, '님이 인사했어요 👋'], 1000);
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain(`${evil}님이 인사했어요 👋`);
    expect(root.querySelector('strong')?.textContent).toBe(evil);
  });

  test('toast disappears after ms; action button runs onClick and dismisses', () => {
    const hud = new Hud(root);
    hud.toast(['잠깐 후에 다시 인사할 수 있어요'], 1000);
    expect(root.textContent).toContain('잠깐 후에 다시 인사할 수 있어요');
    vi.advanceTimersByTime(1500);
    expect(root.textContent).not.toContain('잠깐 후에 다시 인사할 수 있어요');

    const onClick = vi.fn();
    hud.toast([{ strong: '지우' }, '님이 인사했어요 👋'], 5000, { label: '인사 받기', onClick });
    const btn = root.querySelector('button')!;
    expect(btn.textContent).toBe('인사 받기');
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(root.querySelector('button')).toBeNull();
  });

  test('zone, focus, today time and prompt pills', () => {
    const hud = new Hud(root);
    hud.setZone('studyA');
    expect(root.textContent).toContain('스터디룸 A');
    hud.setZone('lounge');
    expect(root.textContent).toContain('라운지');
    expect(root.textContent).not.toContain('스터디룸 A');

    hud.setFocus(true);
    expect(root.textContent).toContain('🔒 집중 모드 · 인사를 받지 않아요');
    hud.setFocus(false);
    expect(root.textContent).not.toContain('집중 모드');

    hud.setMyToday(3723);
    expect(root.textContent).toContain('01:02:03');

    hud.setPrompt({ kind: 'sit', seatId: 'R01', text: 'E 앉기' }, '오늘 이 자리에서 1시간 5분 공부했어요');
    expect(root.textContent).toContain('E 앉기');
    expect(root.textContent).toContain('오늘 이 자리에서 1시간 5분 공부했어요');
    hud.setPrompt(null);
    expect(root.textContent).not.toContain('E 앉기');

    hud.setBreakLeft(65);
    expect(root.textContent).toContain('휴식 01:05');
    hud.setBreakLeft(null);
    expect(root.textContent).not.toContain('휴식');
  });
});

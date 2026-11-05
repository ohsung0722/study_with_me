import { describe, expect, test } from 'vitest';
import { boardSummary, drawBoard } from '../src/ui/boardTexture';
import { formatHoursMinutes } from '../src/ui/format';

/** Records fillText calls; every other 2D call is a no-op. */
function fakeCtx() {
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(t, k) {
      if (k === 'fillText') return (s: string) => texts.push(s);
      if (k === 'measureText') return (s: string) => ({ width: s.length * 10 });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

describe('board texture', () => {
  test('summary text: people and total hours', () => {
    expect(boardSummary({ dayKey: 'd', people: 12, totalSec: 3 * 3600, top5: [] })).toBe('오늘 12명 · 총 3시간');
    expect(boardSummary({ dayKey: 'd', people: 2, totalSec: 5400, top5: [] })).toBe('오늘 2명 · 총 1.5시간');
    expect(boardSummary({ dayKey: 'd', people: 0, totalSec: 0, top5: [] })).toBe('오늘 0명 · 총 0시간');
  });

  test('formatHoursMinutes', () => {
    expect(formatHoursMinutes(3900)).toBe('1시간 5분');
    expect(formatHoursMinutes(59)).toBe('0시간 0분');
  });

  test('drawBoard writes the summary and up to 5 ranked nicknames via fillText', () => {
    const { ctx, texts } = fakeCtx();
    const top5 = ['가', '나', '다', '라', '마', '바'].map((nickname, i) => ({ nickname, sec: 3600 * (6 - i) }));
    drawBoard(ctx, 768, 496, { dayKey: 'd', people: 6, totalSec: 21 * 3600, top5 });
    expect(texts).toContain('오늘 6명 · 총 21시간');
    expect(texts).toContain('가');
    expect(texts).toContain('마');
    expect(texts).not.toContain('바');
    expect(texts).toContain('6시간 0분');
  });

  test('drawBoard with no records shows an empty-state line', () => {
    const { ctx, texts } = fakeCtx();
    drawBoard(ctx, 768, 496, { dayKey: 'd', people: 0, totalSec: 0, top5: [] });
    expect(texts).toContain('아직 기록이 없어요');
  });
});

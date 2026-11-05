// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { TabTitle } from '../src/ui/tabTitle';

let visibility: DocumentVisibilityState = 'hidden';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
Object.defineProperty(document, 'hidden', { configurable: true, get: () => visibility !== 'visible' });

const icon = () => document.head.querySelector<HTMLLinkElement>('link[rel~="icon"]');

afterEach(() => {
  document.head.querySelectorAll('link').forEach((l) => l.remove());
});

describe('TabTitle', () => {
  test('TabTitle.alert sets title and restores on visibilitychange to visible', () => {
    document.title = 'Studyverse';
    visibility = 'hidden';
    const t = new TabTitle(document);
    t.alert('⏰ 휴식 끝!');
    expect(document.title).toBe('⏰ 휴식 끝!');
    expect(icon()?.href).toMatch(/^data:image\/svg\+xml/);

    document.dispatchEvent(new Event('visibilitychange')); // still hidden → keep alert
    expect(document.title).toBe('⏰ 휴식 끝!');

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.title).toBe('Studyverse');
    expect(icon()).toBeNull(); // there was no favicon before → the temporary one is removed
    t.dispose();
  });

  test('restores an existing favicon; repeated alerts keep the original title', () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = 'http://localhost/favicon.ico';
    document.head.appendChild(link);
    document.title = 'Studyverse';
    visibility = 'hidden';
    const t = new TabTitle(document);
    t.alert('⏰ 휴식 끝!');
    t.alert('⏰ 휴식 끝!');
    expect(icon()?.href).toMatch(/^data:/);
    t.clear();
    expect(document.title).toBe('Studyverse');
    expect(icon()?.href).toBe('http://localhost/favicon.ico');
    t.clear(); // no-op
    expect(document.title).toBe('Studyverse');
    t.dispose();
  });
});

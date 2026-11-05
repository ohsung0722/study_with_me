import { describe, expect, test } from 'vitest';
import { InputState } from '../src/game/input';

function fakeWindow() {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = Object.assign(new EventTarget(), { document: doc });
  const key = (type: 'keydown' | 'keyup', code: string) => win.dispatchEvent(Object.assign(new Event(type), { code }));
  return { win: win as unknown as Window, doc, key };
}

describe('InputState', () => {
  test('axis: W forward, D right, opposing cancel, arrows work', () => {
    const { win, key } = fakeWindow();
    const inp = new InputState(win);
    key('keydown', 'KeyW'); key('keydown', 'KeyD');
    expect(inp.axis()).toEqual({ x: 1, z: 1 });
    key('keydown', 'KeyA');
    expect(inp.axis()).toEqual({ x: 0, z: 1 });
    key('keyup', 'KeyW'); key('keydown', 'ArrowDown');
    expect(inp.axis()).toEqual({ x: 0, z: -1 });
  });

  test('InputState clears keys on window blur', () => {
    const { win, key } = fakeWindow();
    const inp = new InputState(win);
    key('keydown', 'KeyW');
    win.dispatchEvent(new Event('blur'));
    expect(inp.keys.size).toBe(0);
    expect(inp.axis()).toEqual({ x: 0, z: 0 });
  });

  test('clears keys when the document becomes hidden', () => {
    const { win, doc, key } = fakeWindow();
    const inp = new InputState(win);
    key('keydown', 'KeyW');
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(inp.keys.size).toBe(0);
  });

  test('consumePressed is true once per press, ignoring auto-repeat', () => {
    const { win, key } = fakeWindow();
    const inp = new InputState(win);
    key('keydown', 'KeyE'); key('keydown', 'KeyE');
    expect(inp.consumePressed('KeyE')).toBe(true);
    expect(inp.consumePressed('KeyE')).toBe(false);
    key('keyup', 'KeyE'); key('keydown', 'KeyE');
    expect(inp.consumePressed('KeyE')).toBe(true);
  });

  test('dispose removes listeners', () => {
    const { win, key } = fakeWindow();
    const inp = new InputState(win);
    inp.dispose();
    key('keydown', 'KeyW');
    expect(inp.keys.size).toBe(0);
  });
});

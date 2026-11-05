import { describe, expect, test } from 'vitest';
import { MoveSender } from '../src/game/moveSender';

describe('MoveSender', () => {
  test('rate limited to one send per interval', () => {
    const sent: unknown[] = [];
    const m = new MoveSender(p => sent.push(p), 100);
    m.update(0, { x: 0, z: 0, ry: 0 });
    m.update(50, { x: 1, z: 0, ry: 0 });
    expect(sent).toHaveLength(1);
    m.update(100, { x: 1, z: 0, ry: 0 });
    expect(sent).toHaveLength(2);
  });
  test('no send when unchanged', () => {
    const sent: unknown[] = [];
    const m = new MoveSender(p => sent.push(p), 100);
    m.update(0, { x: 1, z: 1, ry: 0 });
    m.update(200, { x: 1, z: 1, ry: 0.0001 });
    expect(sent).toHaveLength(1);
  });
  test('flush sends immediately if changed, not otherwise', () => {
    const sent: unknown[] = [];
    const m = new MoveSender(p => sent.push(p), 100);
    m.update(0, { x: 0, z: 0, ry: 0 });
    m.flush(10, { x: 2, z: 0, ry: 0 });
    expect(sent).toHaveLength(2);
    m.flush(20, { x: 2, z: 0, ry: 0 });
    expect(sent).toHaveLength(2);
  });
});

import { beforeEach, describe, expect, test } from 'vitest';
import { BUILDING_ID, kstDayKey } from '@studyverse/shared';
import { openStore, type RecordStore } from '../src/store/store';
import { runAdmin } from '../src/admin';

const env = { STUDYVERSE_ADMIN_KEY: 'sekret' };
const run = (store: RecordStore, ...args: string[]) => runAdmin(['--key', 'sekret', ...args], env, store);
const WRONG = '관리자 키가 올바르지 않습니다';
const NOT_FOUND = '해당 사용자를 찾을 수 없습니다';

let store: RecordStore;
beforeEach(() => { store = openStore(':memory:'); });

describe('admin cli', () => {
  test('admin rejects missing or wrong key', () => {
    store.upsertProfile('u1', '가나다');
    expect(runAdmin(['today'], env, store)).toEqual({ code: 1, out: WRONG });
    expect(runAdmin(['--key', 'nope', 'today'], env, store)).toEqual({ code: 1, out: WRONG });
    expect(runAdmin(['--key', 'sekret', 'today'], {}, store)).toEqual({ code: 1, out: WRONG });
    expect(runAdmin(['--key', '', 'today'], { STUDYVERSE_ADMIN_KEY: '' }, store)).toEqual({ code: 1, out: WRONG });
    expect(store.isHidden('u1')).toBe(false);
  });

  test('admin hide/rename/delete/today operate on store', () => {
    const now = Date.now();
    const day = kstDayKey(now);
    store.upsertProfile('u1', '가나다');
    store.addSession({ anonId: 'u1', buildingId: BUILDING_ID, seatId: 'R01', startMs: now - 120_000, endMs: now - 60_000 });

    expect(run(store, 'hide', 'u1').code).toBe(0);
    expect(store.isHidden('u1')).toBe(true);
    expect(store.displayName('u1')).toBe('익명');
    expect(run(store, 'unhide', 'u1').code).toBe(0);
    expect(store.isHidden('u1')).toBe(false);

    expect(run(store, 'rename', 'u1', '새이름').code).toBe(0);
    expect(store.displayName('u1')).toBe('새이름');

    const today = run(store, 'today');
    expect(today.code).toBe(0);
    expect(today.out).toContain(day);
    expect(today.out).toContain('새이름');

    expect(store.userDaySec('u1', day)).toBeGreaterThan(0);
    expect(run(store, 'delete', 'u1', day).code).toBe(0);
    expect(store.userDaySec('u1', day)).toBe(0);
    expect(run(store, 'delete', 'u1').code).toBe(0);

    for (const cmd of ['hide', 'unhide', 'rename', 'delete']) {
      expect(run(store, cmd, 'ghost', '이름')).toEqual({ code: 1, out: NOT_FOUND });
    }
  });

  test('admin rename validates nickname', () => {
    store.upsertProfile('u1', '가나다');
    const r = run(store, 'rename', 'u1', 'a');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/[가-힣]/);
    expect(run(store, 'rename', 'u1', '씨발놈').code).toBe(1);
    expect(store.displayName('u1')).toBe('가나다');
  });

  test('unknown command or missing args prints usage', () => {
    expect(run(store, 'bogus')).toMatchObject({ code: 1 });
    expect(run(store, 'bogus').out).toContain('사용법');
    expect(run(store).code).toBe(1);
    expect(run(store, 'hide').code).toBe(1);
  });
});

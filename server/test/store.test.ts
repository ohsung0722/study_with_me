import { describe, expect, test } from 'vitest';
import { openStore } from '../src/store/store';

const KST = 9 * 3600 * 1000;
// KST wall-clock -> epoch ms
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - KST;
const DAY = '2026-11-05';
const H = 3600 * 1000;

function sess(anonId: string, seatId: string, startMs: number, sec: number) {
  return { anonId, buildingId: 'main', seatId, startMs, endMs: startMs + sec * 1000 };
}

describe('RecordStore', () => {
  test('addSession splits across KST midnight', () => {
    const s = openStore(':memory:');
    s.addSession(sess('a', 's1', at(2026, 11, 4, 23, 50), 1200));
    expect(s.userDaySec('a', '2026-11-04')).toBe(600);
    expect(s.userDaySec('a', '2026-11-05')).toBe(600);
    s.close();
  });

  test('todayStats: people, total, top5 order and limit', () => {
    const s = openStore(':memory:');
    const base = at(2026, 11, 5, 9);
    const secs = [100, 600, 300, 500, 200, 400];
    secs.forEach((sec, i) => {
      s.upsertProfile(`u${i}`, `n${i}`);
      s.addSession(sess(`u${i}`, `seat${i}`, base, sec));
    });
    s.addSession(sess('u0', 'seat0', base + H, 50)); // second session, same person
    const t = s.todayStats(DAY, 'main');
    expect(t.dayKey).toBe(DAY);
    expect(t.people).toBe(6);
    expect(t.totalSec).toBe(2150);
    expect(t.top5).toEqual([
      { nickname: 'n1', sec: 600 },
      { nickname: 'n3', sec: 500 },
      { nickname: 'n5', sec: 400 },
      { nickname: 'n2', sec: 300 },
      { nickname: 'n4', sec: 200 },
    ]);
    expect(s.todayStats(DAY, 'other').people).toBe(0);
    s.close();
  });

  test('top5 ties break by nickname asc', () => {
    const s = openStore(':memory:');
    s.upsertProfile('x', 'bb');
    s.upsertProfile('y', 'aa');
    s.addSession(sess('x', 's1', at(2026, 11, 5, 9), 60));
    s.addSession(sess('y', 's2', at(2026, 11, 5, 9), 60));
    expect(s.todayStats(DAY, 'main').top5.map((e) => e.nickname)).toEqual(['aa', 'bb']);
    s.close();
  });

  test('hidden profile is excluded from top5 but counted in people/total', () => {
    const s = openStore(':memory:');
    s.upsertProfile('a', 'alice');
    s.upsertProfile('b', 'bob');
    s.addSession(sess('a', 's1', at(2026, 11, 5, 9), 900));
    s.addSession(sess('b', 's2', at(2026, 11, 5, 9), 100));
    s.setHidden('a', true);
    const t = s.todayStats(DAY, 'main');
    expect(t.people).toBe(2);
    expect(t.totalSec).toBe(1000);
    expect(t.top5).toEqual([{ nickname: 'bob', sec: 100 }]);
    s.close();
  });

  test('rename survives later upsertProfile and displayName returns it', () => {
    const s = openStore(':memory:');
    s.upsertProfile('a', 'old');
    s.rename('a', 'renamed');
    expect(s.displayName('a')).toBe('renamed');
    s.upsertProfile('a', 'newer');
    expect(s.displayName('a')).toBe('renamed');
    s.addSession(sess('a', 's1', at(2026, 11, 5, 9), 60));
    expect(s.todayStats(DAY, 'main').top5[0].nickname).toBe('renamed');
    s.close();
  });

  test('displayName of hidden profile is 익명; unknown is empty', () => {
    const s = openStore(':memory:');
    s.upsertProfile('a', 'alice');
    expect(s.displayName('a')).toBe('alice');
    s.setHidden('a', true);
    expect(s.displayName('a')).toBe('익명');
    s.setHidden('a', false);
    expect(s.displayName('a')).toBe('alice');
    expect(s.displayName('nobody')).toBe('');
    s.close();
  });

  test('seatDaySec sums only that seat for that day', () => {
    const s = openStore(':memory:');
    s.addSession(sess('a', 's1', at(2026, 11, 5, 9), 100));
    s.addSession(sess('b', 's1', at(2026, 11, 5, 11), 50));
    s.addSession(sess('a', 's2', at(2026, 11, 5, 13), 999));
    s.addSession(sess('a', 's1', at(2026, 11, 4, 9), 777));
    expect(s.seatDaySec('s1', DAY, 'main')).toBe(150);
    expect(s.seatDaySec('s1', DAY, 'other')).toBe(0);
    s.close();
  });

  test('deleteSessions removes rows and returns count', () => {
    const s = openStore(':memory:');
    s.addSession(sess('a', 's1', at(2026, 11, 4, 9), 100));
    s.addSession(sess('a', 's1', at(2026, 11, 5, 9), 100));
    s.addSession(sess('a', 's1', at(2026, 11, 5, 12), 100));
    s.addSession(sess('b', 's1', at(2026, 11, 5, 9), 100));
    expect(s.deleteSessions('a', DAY)).toBe(2);
    expect(s.userDaySec('a', DAY)).toBe(0);
    expect(s.userDaySec('a', '2026-11-04')).toBe(100);
    expect(s.deleteSessions('a')).toBe(1);
    expect(s.userDaySec('b', DAY)).toBe(100);
    s.close();
  });
});

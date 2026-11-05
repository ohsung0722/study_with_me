import { DatabaseSync } from 'node:sqlite';
import { splitAtKstMidnight, type TodayStats } from '@studyverse/shared';

export interface SessionInput { anonId: string; buildingId: string; seatId: string; startMs: number; endMs: number }

export interface RecordStore {
  upsertProfile(anonId: string, nickname: string): void;
  displayName(anonId: string): string;
  addSession(s: SessionInput): void;
  todayStats(dayKey: string, buildingId: string): TodayStats;
  userDaySec(anonId: string, dayKey: string): number;
  seatDaySec(seatId: string, dayKey: string, buildingId: string): number;
  setHidden(anonId: string, hidden: boolean): void;
  isHidden(anonId: string): boolean;
  rename(anonId: string, nickname: string): void;
  deleteSessions(anonId: string, dayKey?: string): number;
  /** Admin: profiles whose nickname or admin name contains `text`. */
  findProfiles(text: string): AdminProfile[];
  /** Admin: the same top 5 as the public board, with each row's anonId. */
  adminTop5(dayKey: string, buildingId: string): { anonId: string; nickname: string; sec: number }[];
  close(): void;
}

export interface AdminProfile { anonId: string; nickname: string; adminName: string | null; hidden: boolean }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (
  anon_id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  admin_name TEXT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  updated_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  anon_id TEXT NOT NULL,
  building_id TEXT NOT NULL,
  seat_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_building_day ON sessions(building_id, day_key);
CREATE INDEX IF NOT EXISTS idx_sessions_anon_day ON sessions(anon_id, day_key);
`;

const num = (v: unknown): number => Number(v ?? 0);

export function openStore(path: string): RecordStore {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  const upsertProfile = db.prepare(
    `INSERT INTO profiles(anon_id, nickname, updated_ms) VALUES (?, ?, ?)
     ON CONFLICT(anon_id) DO UPDATE SET nickname = excluded.nickname, updated_ms = excluded.updated_ms`,
  );
  const getProfile = db.prepare('SELECT nickname, admin_name, hidden FROM profiles WHERE anon_id = ?');
  const insertSession = db.prepare(
    'INSERT INTO sessions(anon_id, building_id, seat_id, day_key, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const peopleTotal = db.prepare(
    `SELECT COUNT(DISTINCT anon_id) AS people, COALESCE(SUM(end_ms - start_ms), 0) AS ms
     FROM sessions WHERE building_id = ? AND day_key = ?`,
  );
  const topRows = db.prepare(
    `SELECT s.anon_id AS anon_id, COALESCE(p.admin_name, p.nickname, '') AS name, SUM(s.end_ms - s.start_ms) AS ms
     FROM sessions s LEFT JOIN profiles p ON p.anon_id = s.anon_id
     WHERE s.building_id = ? AND s.day_key = ? AND COALESCE(p.hidden, 0) = 0
     GROUP BY s.anon_id
     ORDER BY ms DESC, name ASC
     LIMIT 5`,
  );
  const userMs = db.prepare(
    'SELECT COALESCE(SUM(end_ms - start_ms), 0) AS ms FROM sessions WHERE anon_id = ? AND day_key = ?',
  );
  const seatMs = db.prepare(
    `SELECT COALESCE(SUM(end_ms - start_ms), 0) AS ms FROM sessions
     WHERE seat_id = ? AND day_key = ? AND building_id = ?`,
  );
  const setHidden = db.prepare('UPDATE profiles SET hidden = ? WHERE anon_id = ?');
  const rename = db.prepare('UPDATE profiles SET admin_name = ? WHERE anon_id = ?');
  const delDay = db.prepare('DELETE FROM sessions WHERE anon_id = ? AND day_key = ?');
  const delAll = db.prepare('DELETE FROM sessions WHERE anon_id = ?');
  const findProfiles = db.prepare(
    `SELECT anon_id, nickname, admin_name, hidden FROM profiles
     WHERE instr(nickname, ?1) > 0 OR instr(COALESCE(admin_name, ''), ?1) > 0
     ORDER BY updated_ms DESC`,
  );

  return {
    upsertProfile(anonId, nickname) {
      upsertProfile.run(anonId, nickname, Date.now());
    },
    displayName(anonId) {
      const r = getProfile.get(anonId);
      if (!r) return '';
      if (num(r.hidden) === 1) return '익명';
      return String(r.admin_name ?? r.nickname);
    },
    isHidden(anonId) {
      const r = getProfile.get(anonId);
      return r ? num(r.hidden) === 1 : false;
    },
    addSession(s) {
      for (const part of splitAtKstMidnight(s.startMs, s.endMs)) {
        insertSession.run(s.anonId, s.buildingId, s.seatId, part.dayKey, part.startMs, part.endMs);
      }
    },
    todayStats(dayKey, buildingId) {
      const t = peopleTotal.get(buildingId, dayKey)!;
      return {
        dayKey,
        people: num(t.people),
        totalSec: Math.floor(num(t.ms) / 1000),
        top5: topRows.all(buildingId, dayKey).map((r) => ({
          nickname: String(r.name),
          sec: Math.floor(num(r.ms) / 1000),
        })),
      };
    },
    userDaySec(anonId, dayKey) {
      return Math.floor(num(userMs.get(anonId, dayKey)!.ms) / 1000);
    },
    seatDaySec(seatId, dayKey, buildingId) {
      return Math.floor(num(seatMs.get(seatId, dayKey, buildingId)!.ms) / 1000);
    },
    setHidden(anonId, hidden) {
      setHidden.run(hidden ? 1 : 0, anonId);
    },
    rename(anonId, nickname) {
      rename.run(nickname, anonId);
    },
    deleteSessions(anonId, dayKey) {
      const r = dayKey === undefined ? delAll.run(anonId) : delDay.run(anonId, dayKey);
      return num(r.changes);
    },
    findProfiles(text) {
      return findProfiles.all(text).map((r) => ({
        anonId: String(r.anon_id), nickname: String(r.nickname),
        adminName: r.admin_name == null ? null : String(r.admin_name), hidden: num(r.hidden) === 1,
      }));
    },
    adminTop5(dayKey, buildingId) {
      return topRows.all(buildingId, dayKey).map((r) => ({
        anonId: String(r.anon_id), nickname: String(r.name), sec: Math.floor(num(r.ms) / 1000),
      }));
    },
    close() {
      db.close();
    },
  };
}

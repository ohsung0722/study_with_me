import { pathToFileURL } from 'node:url';
import { BUILDING_ID, kstDayKey, validateNickname } from '@studyverse/shared';
import { openStore, type RecordStore } from './store/store';

const USAGE = [
  '사용법: npm run admin -- --key <키> <명령>',
  '  today                         오늘의 기록 보기',
  '  hide <anonId>                 랭킹에서 숨기기',
  '  unhide <anonId>               숨김 해제',
  '  rename <anonId> <닉네임>      닉네임 변경',
  '  delete <anonId> [날짜키]      기록 삭제 (날짜키: YYYY-MM-DD, 생략 시 전체)',
].join('\n');

const fail = (out: string) => ({ code: 1, out });
const ok = (out: string) => ({ code: 0, out });

function fmtSec(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}시간 ${m}분` : m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

export function runAdmin(
  argv: string[],
  env: Record<string, string | undefined>,
  store: RecordStore,
): { code: number; out: string } {
  const args = [...argv];
  let key: string | undefined;
  const ki = args.indexOf('--key');
  if (ki >= 0) { key = args[ki + 1]; args.splice(ki, 2); }
  const expected = env.STUDYVERSE_ADMIN_KEY;
  if (!expected || key !== expected) return fail('관리자 키가 올바르지 않습니다');

  const [cmd, anonId, ...rest] = args;
  if (cmd === 'today') {
    const day = kstDayKey(Date.now());
    const t = store.todayStats(day, BUILDING_ID);
    const lines = [`날짜: ${day} (KST)`, `공부한 사람: ${t.people}명`, `총 공부 시간: ${fmtSec(t.totalSec)}`];
    if (t.top5.length > 0) {
      lines.push('상위 5명:');
      t.top5.forEach((r, i) => lines.push(`  ${i + 1}. ${r.nickname} - ${fmtSec(r.sec)}`));
    }
    return ok(lines.join('\n'));
  }
  if (cmd !== 'hide' && cmd !== 'unhide' && cmd !== 'rename' && cmd !== 'delete') {
    return fail(`알 수 없는 명령입니다\n${USAGE}`);
  }
  if (!anonId) return fail(`anonId가 필요합니다\n${USAGE}`);
  if (store.displayName(anonId) === '') return fail('해당 사용자를 찾을 수 없습니다');

  switch (cmd) {
    case 'hide': store.setHidden(anonId, true); return ok('숨김 처리했습니다');
    case 'unhide': store.setHidden(anonId, false); return ok('숨김을 해제했습니다');
    case 'rename': {
      if (rest.length === 0) return fail(`닉네임이 필요합니다\n${USAGE}`);
      const v = validateNickname(rest.join(' '));
      if (!v.ok) return fail(v.reason === 'length' ? '닉네임은 2~12자여야 합니다' : '사용할 수 없는 닉네임입니다');
      store.rename(anonId, v.value);
      return ok(`닉네임을 '${v.value}'(으)로 변경했습니다`);
    }
    default: {
      const n = store.deleteSessions(anonId, rest[0]);
      return ok(`기록 ${n}건을 삭제했습니다`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = openStore(process.env.STUDYVERSE_DB ?? 'data/studyverse.db');
  const { code, out } = runAdmin(process.argv.slice(2), process.env, store);
  store.close();
  console.log(out);
  process.exit(code);
}

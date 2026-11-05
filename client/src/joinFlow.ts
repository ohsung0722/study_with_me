// Join with retries, shared by the first entry (main.ts) and re-joins after a reconnect (Game).
import type { JoinOk, JoinResult, Profile } from '@studyverse/shared';
import type { GameConnection } from './net';

export const JOIN_RETRY_MS = 5000;

/**
 * Joins until ok. `full` → onFull() and retry; `nickname` → returned as is; no ack within the join timeout →
 * the first join may still have succeeded server-side, and the server ignores a repeat join on a joined
 * socket (R21), so drop buffered packets and reconnect the socket (fresh connId) before retrying.
 * Resolves null once `cancelled()` is true.
 */
export async function joinWithRetry(
  conn: GameConnection,
  profile: Profile,
  hooks: { onFull?(): void; cancelled?(): boolean } = {},
): Promise<JoinOk | { ok: false; reason: 'nickname' } | null> {
  for (;;) {
    if (hooks.cancelled?.()) return null;
    let r: JoinResult | null = null;
    try {
      r = await conn.join(profile);
    } catch {
      conn.socket.sendBuffer = [];
      conn.socket.disconnect();
      conn.socket.connect();
    }
    if (r?.ok) return r;
    if (r?.reason === 'nickname') return { ok: false, reason: 'nickname' };
    if (r?.reason === 'full') hooks.onFull?.();
    await new Promise((res) => setTimeout(res, JOIN_RETRY_MS));
    if (hooks.cancelled?.()) return null;
  }
}

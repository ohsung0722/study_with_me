import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, JoinResult, Profile, ServerToClient } from '@studyverse/shared';

export interface GameConnection {
  socket: Socket<ServerToClient, ClientToServer>;
  serverOffsetMs: number;
  join(p: Profile): Promise<JoinResult>;
}

const JOIN_TIMEOUT_MS = 5000;

export function connect(): GameConnection {
  const socket: Socket<ServerToClient, ClientToServer> = io({ path: '/socket.io' });
  const conn: GameConnection = {
    socket,
    serverOffsetMs: 0,
    join(p) {
      return new Promise<JoinResult>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('join timeout')), JOIN_TIMEOUT_MS);
        socket.emit('join', p, (r) => {
          clearTimeout(timer);
          if (r.ok) conn.serverOffsetMs = r.serverNow - Date.now();
          resolve(r);
        });
      });
    },
  };
  return conn;
}

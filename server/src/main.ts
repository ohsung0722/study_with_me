import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServer, ServerToClient } from '@studyverse/shared';
import { World } from './game/world';
import { attachSocketTransport } from './net/socketTransport';
import { openStore } from './store/store';

export async function startServer(
  opts: { port: number; dbPath: string; clientDist?: string },
): Promise<{ port: number; close(): Promise<void> }> {
  if (opts.dbPath !== ':memory:') mkdirSync(dirname(resolve(opts.dbPath)), { recursive: true });
  const store = openStore(opts.dbPath);

  const app = express();
  if (opts.clientDist) app.use(express.static(opts.clientDist));
  const http = createServer(app);
  const io = new Server<ClientToServer, ServerToClient>(http);
  const transport = attachSocketTransport(io, (out) => new World({ now: Date.now, store, out }));

  try {
    await new Promise<void>((res, rej) => {
      http.once('error', rej);
      http.listen(opts.port, () => { http.off('error', rej); res(); });
    });
  } catch (e) {
    transport.stop();
    store.close();
    throw e;
  }

  let closing: Promise<void> | undefined;
  const close = () => (closing ??= (async () => {
    transport.stop();
    transport.world.shutdown();
    await io.close(); // also closes the underlying http server
    store.close();
    if (http.listening) await new Promise<void>((r) => http.close(() => r()));
  })());

  return { port: (http.address() as AddressInfo).port, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const dbPath = process.env.STUDYVERSE_DB ?? 'data/studyverse.db';
  const dist = resolve('client/dist');
  const srv = await startServer({ port, dbPath, clientDist: existsSync(dist) ? dist : undefined });
  console.log(`Studyverse 서버 실행 중: http://localhost:${srv.port}`);
  const shutdown = () => { void srv.close().finally(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/* The window's end of the local link agents use: an owner-only Unix socket, or on
   Windows a named pipe. One JSON request per line in, one reply line out; what the lines say is the host's business
   (bridge-protocol.ts). The other end is `openpixel --mcp` (core/app/src/bridge.rs). */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import type { BridgeHandlers, BridgeListener } from '../platform';

const PIPE_PREFIX = '\\\\.\\pipe\\';

/** The Windows pipe for a person: `\\.\pipe\openpixel-<user>`, with anything but letters, digits, `.`, `_` and `-`
    in the name written as `_` (core/app/src/bridge.rs makes the same name). */
export function pipeName(user: string): string {
  const clean = user.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${PIPE_PREFIX}openpixel-${clean === '' ? 'user' : clean}`;
}

/** Where to listen for `path`: the path itself, or on Windows a pipe that stands for it (pipes are not files). */
export function listenAddress(socketPath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32' || socketPath.startsWith(PIPE_PREFIX)) return socketPath;
  return `${PIPE_PREFIX}openpixel-${createHash('sha256').update(socketPath).digest('hex').slice(0, 24)}`;
}

/** Listens for agents. Throws when the path cannot be a socket's; what the system refuses later (the folder cannot
    be written, …) goes to `handlers.failed`. */
export function listen(socketPath: string, handlers: BridgeHandlers): BridgeListener {
  const address = listenAddress(socketPath);
  const pipe = address.startsWith(PIPE_PREFIX);
  // A Unix socket's path has to fit in the system's small fixed space for it (the system would cut a longer one
  // short and listen somewhere nobody looks).
  const room = process.platform === 'darwin' ? 103 : 107;
  if (!pipe && Buffer.byteLength(address) > room) throw new Error(`the socket's path is too long (${Buffer.byteLength(address)} bytes, ${room} at most): ${address}`);
  const sockets = new Set<net.Socket>();
  let nextID = 0;
  let stopped = false;

  const server = net.createServer((socket) => {
    nextID += 1;
    const id = nextID;
    sockets.add(socket);
    handlers.opened(id);
    let pending: Buffer = Buffer.alloc(0);
    // A connection's lines are answered one after the other, in the order they came.
    let work: Promise<void> = Promise.resolve();
    const answer = async (line: string): Promise<void> => {
      let reply: string;
      try {
        reply = await handlers.line(line, id);
      } catch (e) {
        reply = JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      if (!socket.destroyed) socket.write(reply + '\n');
    };
    socket.on('data', (chunk: Buffer) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      for (let nl = pending.indexOf(0x0a); nl >= 0; nl = pending.indexOf(0x0a)) {
        const line = pending.subarray(0, nl).toString('utf8');
        pending = pending.subarray(nl + 1);
        work = work.then(() => answer(line));
      }
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      sockets.delete(socket);
      void work.then(() => handlers.closed(id));
    });
  });
  server.on('error', (e) => {
    if (!stopped) handlers.failed?.(e.message);
  });

  if (!pipe) {
    // The folder and the socket are the owner's alone, from the moment they exist.
    fs.mkdirSync(path.dirname(address), { recursive: true, mode: 0o700 });
    fs.rmSync(address, { force: true });
  }
  const mask = pipe ? null : process.umask(0o177);
  try {
    server.listen(address, () => {
      if (!pipe && !stopped) {
        try {
          fs.chmodSync(address, 0o600);
        } catch {
          // Already made with these rights.
        }
      }
    });
  } finally {
    if (mask !== null) process.umask(mask);
  }

  return {
    path: address,
    stop() {
      if (stopped) return;
      stopped = true;
      server.close();
      for (const s of sockets) s.destroy();
      if (!pipe) fs.rmSync(address, { force: true });
    },
  };
}

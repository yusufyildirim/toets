import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { ProtocolError } from '../errors.js';

export interface WsListener {
  readonly port: number;
  /** `ws://localhost:port` for loopback binds, `ws://<host>:port` otherwise. */
  readonly url: string;
  readonly wss: WebSocketServer;
  close(): Promise<void>;
}

/**
 * Opens a WebSocket server. Without `host` it binds loopback only: `127.0.0.1` and, when
 * available, `::1` on the same port, so `localhost` works whichever family a client tries.
 */
export async function listenWebSocket(opts: {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly maxPayload?: number | undefined;
  readonly onConnection: (socket: WebSocket, req: IncomingMessage) => void;
}): Promise<WsListener> {
  const wss = new WebSocketServer({
    noServer: true,
    ...(opts.maxPayload === undefined ? {} : { maxPayload: opts.maxPayload }),
  });
  wss.on('connection', opts.onConnection);
  const servers: Server[] = [];
  const requested = opts.port ?? 0;

  const listenOn = (host: string, port: number): Promise<number> => {
    const server = createServer((_req, res) => {
      res.writeHead(426, { 'content-type': 'text/plain' });
      res.end('dpad SDK host: WebSocket connections only.\n');
    });
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      socket.on('error', () => socket.destroy());
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    return new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host, port, exclusive: true }, () => {
        servers.push(server);
        server.unref();
        resolve((server.address() as AddressInfo).port);
      });
    });
  };
  const closeServers = async (): Promise<void> => {
    const list = servers.splice(0);
    await Promise.all(
      list.map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve());
            s.closeAllConnections();
          }),
      ),
    );
  };

  let port: number;
  let url: string;
  try {
    if (opts.host !== undefined) {
      port = await listenOn(opts.host, requested);
      url = `ws://${urlHost(opts.host)}:${port}`;
    } else {
      port = await listenLoopbackPair(listenOn, closeServers, requested);
      url = `ws://localhost:${port}`;
    }
  } catch (error) {
    await closeServers();
    throw new ProtocolError(
      'sdk.listen-failed',
      `The dpad SDK host could not listen: ${(error as Error).message}`,
      { hint: 'Pick another port or free the requested one.', docs: 'docs/protocol/host', cause: error },
    );
  }

  return {
    port,
    url,
    wss,
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await closeServers();
    },
  };
}

async function listenLoopbackPair(
  listenOn: (host: string, port: number) => Promise<number>,
  closeServers: () => Promise<void>,
  requested: number,
): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const port = await listenOn('127.0.0.1', requested);
    try {
      await listenOn('::1', port);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // With an ephemeral port, retry when the v6 port is taken by someone else: a client
      // resolving localhost to ::1 would otherwise reach them.
      if (code === 'EADDRINUSE' && requested === 0 && attempt < 5) {
        await closeServers();
        continue;
      }
      if (code !== 'EADDRNOTAVAIL' && code !== 'EAFNOSUPPORT' && code !== 'EADDRINUSE') throw error;
    }
    return port;
  }
}

function urlHost(host: string): string {
  if (host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '::') return 'localhost';
  return host.includes(':') ? `[${host}]` : host;
}

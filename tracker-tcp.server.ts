import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createServer, Server, Socket } from 'node:net';
import { DeviceGatewayService } from './device-gateway.service';

/** Optional line-oriented NMEA TCP bridge.
 * Wire format: AUTH <provisioned-device-token>\r\n followed by checksum-valid NMEA RMC lines.
 * Keep this listener behind a TLS TCP proxy/VPN on untrusted networks.
 */
@Injectable()
export class TrackerTcpServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackerTcpServer.name);
  private server?: Server;
  private readonly sockets = new Set<Socket>();
  constructor(private readonly gateway: DeviceGatewayService) {}

  onModuleInit() {
    const rawPort = process.env.TRACKER_TCP_PORT;
    if (!rawPort || rawPort === '0') return;
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('TRACKER_TCP_PORT must be a valid TCP port');
    const host = process.env.TRACKER_TCP_HOST || '0.0.0.0';
    const maxClients = Math.max(1, Math.min(10000, Number(process.env.TRACKER_TCP_MAX_CLIENTS || 500)));
    this.server = createServer(socket => this.accept(socket, maxClients));
    this.server.on('error', error => this.logger.error(`Tracker TCP listener error: ${error.message}`));
    this.server.listen(port, host, () => this.logger.log(`Tracker TCP listener active on ${host}:${port}`));
  }

  private accept(socket: Socket, maxClients: number) {
    if (this.sockets.size >= maxClients) { socket.end('BUSY\r\n'); return; }
    this.sockets.add(socket);
    socket.setTimeout(45_000);
    socket.setNoDelay(true);
    let buffer = '';
    let credential: string | undefined;
    let acceptedLines = 0;
    let windowStarted = Date.now();
    const close = () => { this.sockets.delete(socket); };
    socket.on('close', close);
    socket.on('timeout', () => socket.destroy());
    socket.on('error', () => close());
    socket.on('data', chunk => {
      buffer += chunk.toString('ascii');
      if (buffer.length > 16_384) { socket.end('ERR FRAME_TOO_LARGE\r\n'); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '').trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        if (!credential) {
          const match = /^AUTH ([A-Za-z0-9_-]{32,256})$/.exec(line);
          if (!match) { socket.end('ERR AUTH_REQUIRED\r\n'); return; }
          credential = match[1];
          socket.write('OK AUTHENTICATED\r\n');
          continue;
        }
        if (!line.startsWith('$') || line.length > 1024) { socket.write('ERR NMEA_LINE_INVALID\r\n'); continue; }
        const now = Date.now();
        if (now - windowStarted >= 1000) { windowStarted = now; acceptedLines = 0; }
        acceptedLines += 1;
        if (acceptedLines > 10) { socket.write('ERR RATE_LIMIT\r\n'); socket.destroy(); return; }
        void this.gateway.ingest(`Bearer ${credential}`, 'nmea0183', line)
          .then(result => socket.write(result.duplicate ? 'OK DUPLICATE\r\n' : 'OK ACCEPTED\r\n'))
          .catch(() => socket.write('ERR REJECTED\r\n'));
      }
    });
  }

  async onModuleDestroy() {
    for (const socket of this.sockets) socket.destroy();
    if (this.server?.listening) await new Promise<void>(resolve => this.server!.close(() => resolve()));
  }
}

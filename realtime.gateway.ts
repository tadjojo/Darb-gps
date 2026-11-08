import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, WebSocketGateway, WebSocketServer, WsException,
} from '@nestjs/websockets';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Namespace, Socket } from 'socket.io';
import { PG_POOL } from '../database/database.constants';
import { AuthenticatedUser } from '../auth/auth.types';

interface VehicleRoomRequest { vehicleId: string; }

@Injectable()
@WebSocketGateway({
  namespace: '/tracking',
  transports: ['websocket'],
  cors: {
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      const allowed = (process.env.CORS_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
      callback(null, !origin || allowed.includes(origin));
    },
    credentials: false,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(RealtimeGateway.name);
  private auditTimer?: NodeJS.Timeout;
  private auditRunning = false;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  onModuleInit(): void {
    // Notification fanout is the fast path; this periodic audit repairs missed
    // notifications after transient LISTEN connection loss or process restarts.
    this.auditTimer = setInterval(() => { void this.revalidateConnectedSockets(); }, 30_000);
    this.auditTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.auditTimer) clearInterval(this.auditTimer);
  }

  revokeAccessToken(jti: string): void {
    if (!this.server) return;
    for (const socket of this.server.sockets.values()) {
      if (socket.data.jwtId === jti) socket.disconnect(true);
    }
  }

  revokeVehicleMembership(userId: string, vehicleId: string): void {
    if (!this.server) return;
    const room = this.vehicleRoom(vehicleId);
    for (const socket of this.server.sockets.values()) {
      if (socket.data.userId === userId && socket.rooms.has(room)) {
        void socket.leave(room);
      }
    }
  }

  private async revalidateConnectedSockets(): Promise<void> {
    if (!this.server || this.auditRunning) return;
    this.auditRunning = true;
    try {
      const allSockets = [...this.server.sockets.values()];
      if (!allSockets.length) return;
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      for (const socket of allSockets) {
        const expiresAt = Number(socket.data.jwtExpiresAt);
        const userId = socket.data.userId;
        const jwtId = socket.data.jwtId;
        if (typeof userId !== 'string' || !uuidPattern.test(userId) ||
            typeof jwtId !== 'string' || !uuidPattern.test(jwtId) ||
            !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          socket.disconnect(true);
        }
      }
      const sockets = allSockets.filter(socket => socket.connected &&
        typeof socket.data.userId === 'string' && typeof socket.data.jwtId === 'string' &&
        Number(socket.data.jwtExpiresAt) > Date.now());
      if (!sockets.length) return;
      const activeRows = await this.pool.query(
        `SELECT x.socket_id
           FROM unnest($1::text[], $2::uuid[], $3::uuid[]) AS x(socket_id, user_id, jti)
           LEFT JOIN app_users u ON u.id = x.user_id AND u.status = 'active'
           LEFT JOIN revoked_access_tokens r ON r.jti = x.jti AND r.expires_at > now()
          WHERE u.id IS NULL OR r.jti IS NOT NULL`,
        [sockets.map(s => s.id), sockets.map(s => String(s.data.userId)), sockets.map(s => String(s.data.jwtId))],
      );
      const invalid = new Set<string>(activeRows.rows.map((r: { socket_id: string }) => r.socket_id));
      const roomSockets: Socket[] = [];
      const roomUsers: string[] = [];
      const roomVehicles: string[] = [];
      for (const socket of sockets) {
        if (invalid.has(socket.id)) { socket.disconnect(true); continue; }
        for (const room of socket.rooms) {
          if (room.startsWith('vehicle:')) {
            roomSockets.push(socket);
            roomUsers.push(String(socket.data.userId));
            roomVehicles.push(room.slice('vehicle:'.length));
          }
        }
      }
      if (roomSockets.length) {
        const membershipRows = await this.pool.query(
          `SELECT x.socket_id, x.vehicle_id
             FROM unnest($1::text[], $2::uuid[], $3::uuid[]) AS x(socket_id, user_id, vehicle_id)
             LEFT JOIN vehicles v ON v.id = x.vehicle_id AND v.status = 'active'
             LEFT JOIN vehicle_members vm ON vm.vehicle_id = x.vehicle_id
                  AND vm.user_id = x.user_id AND vm.status = 'active'
            WHERE v.id IS NULL OR vm.user_id IS NULL`,
          [roomSockets.map(s => s.id), roomUsers, roomVehicles],
        );
        const denied = new Set(membershipRows.rows.map((r: { socket_id: string; vehicle_id: string }) => `${r.socket_id}:${r.vehicle_id}`));
        for (let i = 0; i < roomSockets.length; i++) {
          if (denied.has(`${roomSockets[i].id}:${roomVehicles[i]}`)) {
            await roomSockets[i].leave(this.vehicleRoom(roomVehicles[i]));
          }
        }
      }
    } catch (error) {
      this.logger.error('Connected socket authorization audit failed', error instanceof Error ? error.stack : undefined);
    } finally {
      this.auditRunning = false;
    }
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.readToken(client);
      const user = await this.jwt.verifyAsync<AuthenticatedUser & { exp?: number }>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
      if (!user.sub || !user.jti || !user.exp) throw new Error('Invalid token claims');
      const active = await this.pool.query(
        `SELECT id FROM app_users u
          WHERE u.id = $1 AND u.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM revoked_access_tokens r WHERE r.jti = $2 AND r.expires_at > now())`, [user.sub, user.jti],
      );
      if (!active.rowCount) throw new Error('Account is not active');
      client.data.userId = user.sub;
      client.data.jwtId = user.jti;
      client.data.jwtExpiresAt = user.exp * 1000;
    } catch {
      client.disconnect(true);
    }
  }

  private readToken(client: Socket): string {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 20) return authToken;
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && /^Bearer\s+\S+$/i.test(header)) return header.replace(/^Bearer\s+/i, '');
    throw new Error('Missing access token');
  }

  @SubscribeMessage('vehicle.join')
  async joinVehicle(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: VehicleRoomRequest,
  ): Promise<{ joined: boolean; vehicleId: string }> {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body || typeof body.vehicleId !== 'string') throw new WsException('Invalid request');
    const access = await this.pool.query(
      `SELECT 1 FROM vehicles v
        JOIN vehicle_members vm ON vm.vehicle_id = v.id
       WHERE v.id = $1 AND v.status = 'active'
         AND vm.user_id = $2 AND vm.status = 'active'`,
      [body.vehicleId, userId],
    );
    if (!access.rowCount) throw new WsException('Vehicle access denied');
    await client.join(this.vehicleRoom(body.vehicleId));
    return { joined: true, vehicleId: body.vehicleId };
  }

  @SubscribeMessage('vehicle.leave')
  async leaveVehicle(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: VehicleRoomRequest,
  ): Promise<{ left: boolean }> {
    if (body?.vehicleId) await client.leave(this.vehicleRoom(body.vehicleId));
    return { left: true };
  }

  emitVehicleLocation(vehicleId: string, event: Record<string, unknown>): void {
    if (!this.server) throw new Error('Socket.IO server is not initialized');
    this.server.to(this.vehicleRoom(vehicleId)).emit('vehicle.location.updated', event);
  }

  private vehicleRoom(vehicleId: string): string { return `vehicle:${vehicleId}`; }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }
}

import {
  ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage,
  WebSocketGateway, WebSocketServer, WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { Inject } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { PG_POOL } from '../database/database.constants';

interface VehicleJoinRequest { vehicleId: string; }
interface LocationEvent {
  vehicleId: string;
  latitude: number;
  longitude: number;
  speedKmh: number;
  heading: number | null;
  recordedAt: string;
  locationId: string | number;
}

@WebSocketGateway({
  namespace: '/tracking',
  transports: ['websocket'],
  cors: {
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      const allowed = (process.env.CORS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
      callback(null, !origin || allowed.includes(origin));
    },
    credentials: false,
  },
})
export class TrackingGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(TrackingGateway.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token;
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_PUBLISHABLE_KEY;
      if (typeof token !== 'string' || !url || !key) throw new Error('Missing authentication');
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) throw new Error('Invalid access token');
      client.data.userId = data.user.id;
    } catch (error) {
      this.logger.warn('Rejected unauthenticated tracking socket');
      client.disconnect(true);
    }
  }

  @SubscribeMessage('vehicle.join')
  async joinVehicle(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: VehicleJoinRequest,
  ): Promise<{ joined: boolean; vehicleId: string }> {
    const userId = client.data.userId as string | undefined;
    const vehicleId = body?.vehicleId;
    if (!userId || typeof vehicleId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vehicleId)) {
      throw new WsException('Invalid vehicle request');
    }
    const access = await this.pool.query(
      `SELECT 1 FROM public.vehicles v
         JOIN public.vehicle_members vm ON vm.vehicle_id = v.id
        WHERE v.id = $1 AND v.status = 'active'
          AND vm.user_id = $2 AND vm.status = 'active'`,
      [vehicleId, userId],
    );
    if (!access.rowCount) throw new WsException('Vehicle access denied');
    await client.join(this.vehicleRoom(vehicleId));
    return { joined: true, vehicleId };
  }

  publishLocation(event: LocationEvent): void {
    if (!this.server) return;
    this.server.to(this.vehicleRoom(event.vehicleId)).emit('vehicle.location.updated', event);
  }

  private vehicleRoom(vehicleId: string): string {
    return `vehicle:${vehicleId}`;
  }
}

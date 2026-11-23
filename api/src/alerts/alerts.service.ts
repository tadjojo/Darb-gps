import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { AuthenticatedUser } from '../auth/auth.types';

type RuleInput = { vehicleId: string; type: 'speed_limit' | 'geofence'; name: string; config: Record<string, number>; enabled?: boolean };

@Injectable()
export class AlertsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(user: AuthenticatedUser, status?: string, vehicleId?: string, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new BadRequestException('Alert limit must be 1..200');
    if (vehicleId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vehicleId)) throw new BadRequestException('Invalid vehicle ID');
    if (status && !['open', 'acknowledged', 'resolved'].includes(status)) throw new BadRequestException('Invalid alert status');
    const result = await this.pool.query(
      `SELECT a.id, a.vehicle_id, v.display_name AS vehicle_name, v.registration_number,
              a.rule_id, a.alert_type, a.severity, a.title, a.message, a.details,
              a.status, a.occurred_at, a.acknowledged_at
         FROM private.darb_alerts a
         JOIN public.vehicles v ON v.id = a.vehicle_id
         JOIN public.vehicle_members vm ON vm.vehicle_id = v.id
        WHERE vm.user_id = $1 AND vm.status = 'active'
          AND ($2::text IS NULL OR a.status = $2)
          AND ($3::uuid IS NULL OR a.vehicle_id = $3)
        ORDER BY a.occurred_at DESC LIMIT $4`,
      [user.sub, status || null, vehicleId || null, limit],
    );
    return result.rows;
  }

  async acknowledge(user: AuthenticatedUser, alertId: string) {
    const result = await this.pool.query(
      `UPDATE private.darb_alerts a
          SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $2
        WHERE a.id = $1 AND a.status = 'open'
          AND EXISTS (
            SELECT 1 FROM public.vehicle_members vm
             WHERE vm.vehicle_id = a.vehicle_id AND vm.user_id = $2 AND vm.status = 'active'
          )
        RETURNING a.id, a.status, a.acknowledged_at`,
      [alertId, user.sub],
    );
    if (!result.rowCount) throw new NotFoundException('Open alert not found or access denied');
    return result.rows[0];
  }

  async resolve(user: AuthenticatedUser, alertId: string) {
    const result = await this.pool.query(
      `UPDATE private.darb_alerts a
          SET status = 'resolved'
        WHERE a.id = $1 AND a.status IN ('open', 'acknowledged')
          AND EXISTS (
            SELECT 1 FROM public.vehicle_members vm
             WHERE vm.vehicle_id = a.vehicle_id AND vm.user_id = $2 AND vm.status = 'active'
          )
        RETURNING a.id, a.status`,
      [alertId, user.sub],
    );
    if (!result.rowCount) throw new NotFoundException('Alert not found or access denied');
    return result.rows[0];
  }

  async rules(user: AuthenticatedUser, vehicleId?: string) {
    if (vehicleId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vehicleId)) throw new BadRequestException('Invalid vehicle ID');
    const result = await this.pool.query(
      `SELECT r.id, r.vehicle_id, v.display_name AS vehicle_name, r.rule_type,
              r.name, r.config, r.enabled, r.created_at, r.updated_at
         FROM private.darb_alert_rules r
         JOIN public.vehicles v ON v.id = r.vehicle_id
         JOIN public.vehicle_members vm ON vm.vehicle_id = v.id
        WHERE vm.user_id = $1 AND vm.status = 'active'
          AND ($2::uuid IS NULL OR r.vehicle_id = $2)
        ORDER BY r.created_at DESC`,
      [user.sub, vehicleId || null],
    );
    return result.rows;
  }

  async createRule(user: AuthenticatedUser, input: RuleInput) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Invalid rule payload');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 120) throw new BadRequestException('Rule name must be 1..120 characters');
    if (typeof input.vehicleId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.vehicleId) || !['speed_limit', 'geofence'].includes(input.type)) throw new BadRequestException('Invalid rule type or vehicle');
    const access = await this.pool.query(
      `SELECT v.organization_id, vm.role
         FROM public.vehicles v
         JOIN public.vehicle_members vm ON vm.vehicle_id = v.id
        WHERE v.id = $1 AND v.status = 'active' AND vm.user_id = $2 AND vm.status = 'active'`,
      [input.vehicleId, user.sub],
    );
    const membership = access.rows[0];
    if (!membership) throw new NotFoundException('Vehicle not found');
    if (!['owner', 'manager'].includes(membership.role)) throw new ForbiddenException('Only vehicle owners or managers can manage alert rules');
    const c = input.config || {};
    if (input.type === 'speed_limit' && (!Number.isFinite(c.limitKmh) || c.limitKmh < 1 || c.limitKmh > 300)) {
      throw new BadRequestException('Speed limit must be between 1 and 300 km/h');
    }
    if (input.type === 'geofence' && (!Number.isFinite(c.latitude) || c.latitude < -90 || c.latitude > 90 ||
        !Number.isFinite(c.longitude) || c.longitude < -180 || c.longitude > 180 ||
        !Number.isFinite(c.radiusMeters) || c.radiusMeters < 25 || c.radiusMeters > 100000)) {
      throw new BadRequestException('Geofence requires valid coordinates and a radius of 25..100000 meters');
    }
    const result = await this.pool.query(
      `INSERT INTO private.darb_alert_rules (organization_id, vehicle_id, rule_type, name, config, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id, vehicle_id, rule_type, name, config, enabled, created_at`,
      [membership.organization_id, input.vehicleId, input.type, name, JSON.stringify(c), input.enabled !== false, user.sub],
    );
    return result.rows[0];
  }

  async evaluateLocation(location: { id: string | number; vehicle_id: string; latitude: number; longitude: number; speed_kmh: number; recorded_at: string | Date }) {
    const rules = await this.pool.query(
      `SELECT r.id, r.organization_id, r.vehicle_id, r.rule_type, r.name, r.config
         FROM private.darb_alert_rules r
        WHERE r.vehicle_id = $1 AND r.enabled = true`,
      [location.vehicle_id],
    );
    if (!rules.rowCount) return;
    const previous = await this.pool.query(
      `SELECT latitude, longitude, speed_kmh FROM public.vehicle_locations
        WHERE vehicle_id = $1 AND (recorded_at, id) < ($2::timestamptz, $3::bigint)
        ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      [location.vehicle_id, location.recorded_at, location.id],
    );
    const prev = previous.rows[0];
    const distance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const rad = (n: number) => n * Math.PI / 180;
      const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
      return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    for (const rule of rules.rows) {
      let alertType: string | null = null, title = '', message = '', severity = 'warning';
      const config = rule.config as Record<string, number>;
      if (rule.rule_type === 'speed_limit') {
        const limit = Number(config.limitKmh);
        if (prev && Number(prev.speed_kmh) <= limit && Number(location.speed_kmh) > limit) {
          alertType = 'speed_limit'; title = 'تجاوز السرعة المحددة';
          message = `تجاوزت المركبة الحد المحدد ${limit} كم/س ووصلت إلى ${Math.round(location.speed_kmh)} كم/س.`;
        }
      } else if (rule.rule_type === 'geofence' && prev) {
        const radius = Number(config.radiusMeters);
        const insideNow = distance(Number(location.latitude), Number(location.longitude), Number(config.latitude), Number(config.longitude)) <= radius;
        const insideBefore = distance(Number(prev.latitude), Number(prev.longitude), Number(config.latitude), Number(config.longitude)) <= radius;
        if (insideNow !== insideBefore) {
          alertType = insideNow ? 'geofence_enter' : 'geofence_exit';
          title = insideNow ? 'دخول نطاق جغرافي' : 'خروج من نطاق جغرافي';
          message = `المركبة ${insideNow ? 'دخلت' : 'غادرت'} النطاق «${rule.name}».`;
          severity = insideNow ? 'info' : 'warning';
        }
      }
      if (!alertType) continue;
      await this.pool.query(
        `INSERT INTO private.darb_alerts
          (organization_id, vehicle_id, rule_id, alert_type, severity, title, message, details, event_key, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         ON CONFLICT (event_key) DO NOTHING`,
        [rule.organization_id, rule.vehicle_id, rule.id, alertType, severity, title, message,
          JSON.stringify({ ruleName: rule.name, speedKmh: location.speed_kmh, latitude: location.latitude, longitude: location.longitude }),
          `${rule.id}:${alertType}:${location.id}`, location.recorded_at],
      );
    }
  }
}
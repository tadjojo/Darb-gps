import { ForbiddenException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { AddVehicleMemberDto } from './dto/add-vehicle-member.dto';

@Injectable()
export class OrganizationsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async createOrganization(user: AuthenticatedUser, dto: CreateOrganizationDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        `INSERT INTO organizations (name) VALUES ($1) RETURNING id, name, status, created_at`,
        [dto.name.trim()],
      );
      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, role, status)
         VALUES ($1, $2, 'org_admin', 'active')`, [created.rows[0].id, user.sub],
      );
      await client.query('COMMIT');
      return created.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async createVehicle(user: AuthenticatedUser, organizationId: string, dto: CreateVehicleDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const membership = await client.query(
        `SELECT role FROM organization_members
          WHERE organization_id = $1 AND user_id = $2 AND status = 'active'
          FOR SHARE`, [organizationId, user.sub],
      );
      if (!membership.rowCount) throw new NotFoundException('Organization not found');
      if (!['org_admin', 'fleet_supervisor'].includes(membership.rows[0].role)) {
        throw new ForbiddenException('Insufficient organization permissions');
      }
      const result = await client.query(
        `INSERT INTO vehicles (organization_id, display_name, registration_number)
         VALUES ($1, $2, $3) RETURNING id, organization_id, display_name, registration_number, status, created_at`,
        [organizationId, dto.displayName.trim(), dto.registrationNumber?.trim() || null],
      );
      const vehicleRole = membership.rows[0].role === 'org_admin' ? 'owner' : 'manager';
      await client.query(
        `INSERT INTO vehicle_members (vehicle_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')`, [result.rows[0].id, user.sub, vehicleRole],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async listVehicles(user: AuthenticatedUser, organizationId: string) {
    const membership = await this.pool.query(
      `SELECT 1 FROM organization_members
        WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
      [organizationId, user.sub],
    );
    if (!membership.rowCount) throw new NotFoundException('Organization not found');
    const result = await this.pool.query(
      `SELECT id, display_name, registration_number, status, created_at
         FROM vehicles WHERE organization_id = $1 ORDER BY created_at DESC`, [organizationId],
    );
    return result.rows;
  }

  async addVehicleMember(user: AuthenticatedUser, vehicleId: string, dto: AddVehicleMemberDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const vehicle = await client.query(
        `SELECT v.organization_id, vm.role AS caller_role FROM vehicles v
          JOIN vehicle_members vm ON vm.vehicle_id = v.id
         WHERE v.id = $1 AND vm.user_id = $2 AND vm.status = 'active'
           AND vm.role IN ('owner','manager')
         FOR UPDATE OF v`, [vehicleId, user.sub],
      );
      if (!vehicle.rowCount) throw new NotFoundException('Vehicle not found or permission denied');
      const organizationMember = await client.query(
        `SELECT 1 FROM organization_members
          WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
        [vehicle.rows[0].organization_id, dto.userId],
      );
      if (!organizationMember.rowCount) throw new ForbiddenException('User must be an active member of this organization');
      if (vehicle.rows[0].caller_role === 'manager' && dto.role === 'manager') {
        throw new ForbiddenException('Only a vehicle owner may appoint another manager');
      }
      await client.query(
        `INSERT INTO vehicle_members (vehicle_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (vehicle_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
        [vehicleId, dto.userId, dto.role],
      );
      await client.query('COMMIT');
      return { vehicleId, userId: dto.userId, role: dto.role, status: 'active' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async revokeVehicleMember(user: AuthenticatedUser, vehicleId: string, memberUserId: string) {
    if (user.sub === memberUserId) {
      throw new ForbiddenException('Self-removal is not allowed; transfer ownership first');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const caller = await client.query(
        `SELECT vm.role AS caller_role
           FROM vehicle_members vm
           JOIN vehicles v ON v.id = vm.vehicle_id
          WHERE vm.vehicle_id = $1 AND vm.user_id = $2
            AND vm.status = 'active' AND v.status = 'active'
          FOR UPDATE OF v`, [vehicleId, user.sub],
      );
      if (!caller.rowCount || !['owner', 'manager'].includes(caller.rows[0].caller_role)) {
        throw new NotFoundException('Vehicle not found or permission denied');
      }
      const target = await client.query(
        `SELECT role FROM vehicle_members
          WHERE vehicle_id = $1 AND user_id = $2 AND status = 'active'
          FOR UPDATE`, [vehicleId, memberUserId],
      );
      if (!target.rowCount) throw new NotFoundException('Active vehicle membership not found');
      const callerRole = caller.rows[0].caller_role;
      const targetRole = target.rows[0].role;
      if (targetRole === 'owner' || (callerRole === 'manager' && targetRole !== 'driver' && targetRole !== 'viewer')) {
        throw new ForbiddenException('Insufficient permission to revoke this membership');
      }
      await client.query(
        `UPDATE vehicle_members SET status = 'revoked'
          WHERE vehicle_id = $1 AND user_id = $2`, [vehicleId, memberUserId],
      );
      await client.query(
        `SELECT pg_notify('darb_vehicle_member_revoked', $1)`,
        [JSON.stringify({ vehicleId, userId: memberUserId })],
      );
      await client.query('COMMIT');
      return { vehicleId, userId: memberUserId, status: 'revoked' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

}

import { BadRequestException, Injectable } from '@nestjs/common';
import { NormalizedTrackerFix, TrackerProtocolAdapter } from '../protocol.types';

@Injectable()
export class JsonTrackerAdapter implements TrackerProtocolAdapter {
  readonly protocol = 'json' as const;
  parse(payload: string): NormalizedTrackerFix {
    try {
      const value = JSON.parse(payload) as Record<string, unknown>;
      const latitude = Number(value.latitude); const longitude = Number(value.longitude);
      const speed = value.speedKmh == null ? null : Number(value.speedKmh);
      const heading = value.heading == null ? null : Number(value.heading);
      const accuracy = value.accuracyMeters == null ? 20 : Number(value.accuracyMeters);
      const recordedAt = new Date(String(value.recordedAt));
      const batteryPercent = value.batteryPercent == null ? null : Number(value.batteryPercent);
      const signalStrengthDbm = value.signalStrengthDbm == null ? null : Number(value.signalStrengthDbm);
      const networkType = value.networkType == null ? null : String(value.networkType).trim();
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('Invalid coordinates');
      if (speed !== null && (!Number.isFinite(speed) || speed < 0 || speed > 400)) throw new Error('Invalid speed');
      if (heading !== null && (!Number.isFinite(heading) || heading < 0 || heading > 360)) throw new Error('Invalid heading');
      if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1000 || !Number.isFinite(recordedAt.getTime())) throw new Error('Invalid accuracy or timestamp');
      if (batteryPercent !== null && (!Number.isInteger(batteryPercent) || batteryPercent < 0 || batteryPercent > 100)) throw new Error('Invalid battery percentage');
      if (signalStrengthDbm !== null && (!Number.isInteger(signalStrengthDbm) || signalStrengthDbm < -160 || signalStrengthDbm > 0)) throw new Error('Invalid signal strength');
      if (networkType !== null && (!networkType || networkType.length > 30)) throw new Error('Invalid network type');
      return { latitude, longitude, speedKmh: speed, heading, accuracyMeters: accuracy, recordedAt, batteryPercent, signalStrengthDbm, networkType };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid tracker JSON');
    }
  }
}

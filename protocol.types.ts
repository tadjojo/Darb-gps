export type TrackerProtocol = 'nmea0183' | 'gt06' | 'json';

export interface NormalizedTrackerFix {
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyMeters: number;
  recordedAt: Date;
  batteryPercent?: number | null;
  signalStrengthDbm?: number | null;
  networkType?: string | null;
}

export interface TrackerProtocolAdapter {
  readonly protocol: TrackerProtocol;
  parse(payload: string): NormalizedTrackerFix;
}

import { buildGt06Ack, Gt06Frame, parseGt06Login, parseGt06Location } from './gt06.parser';

/**
 * Pure GT06 session state transition. The caller owns the socket and must close
 * the connection when close=true. IMEI identifies a device but is not a secret;
 * public deployments must add trusted-network controls or model-specific auth.
 */
export function handleGt06SessionFrame(
  frame: Gt06Frame,
  expectedImei: string,
  authenticated: boolean,
): {
  authenticated: boolean;
  close: boolean;
  ack?: Buffer;
  imei?: string;
  location?: ReturnType<typeof parseGt06Location>;
} {
  if (frame.protocol === 0x01) {
    const login = parseGt06Login(frame);
    if (login.imei !== expectedImei) return { authenticated: false, close: true };
    return { authenticated: true, close: false, imei: login.imei, ack: buildGt06Ack(frame.protocol, frame.serial) };
  }
  if (!authenticated) return { authenticated: false, close: true };
  if (frame.protocol === 0x13) {
    return { authenticated: true, close: false, ack: buildGt06Ack(frame.protocol, frame.serial) };
  }
  if (frame.protocol === 0x12) {
    const location = parseGt06Location(frame);
    return { authenticated: true, close: false, location, ack: buildGt06Ack(frame.protocol, frame.serial) };
  }
  return { authenticated: true, close: false };
}

# Phase 5468 — Optional NMEA TCP ingress

## Delivered
- Optional Nest lifecycle-managed TCP listener (`TRACKER_TCP_PORT`); disabled when unset.
- Per-connection device credential handshake using the existing 256-bit tracker enrollment token.
- Checksum-valid NMEA RMC sentences are handed to the existing normalized ingestion transaction; no second location-writing path was introduced.
- Connection cap, 45-second idle timeout, 16 KiB input buffer ceiling, 1 KiB sentence ceiling, and 10-line/second per-connection limit.
- Responses: `OK AUTHENTICATED`, `OK ACCEPTED`, `OK DUPLICATE`, or generic rejection responses that do not disclose credential or parser details.
- `scripts/send-nmea-tcp.mjs` is a minimal TCP client for controlled integration tests.

## Wire format and compatibility boundary
The bridge expects `AUTH <device-token>\r\n` once after connect, then one NMEA sentence per line. This is a DARB-specific authenticated NMEA-over-TCP profile. It is **not** a claim that arbitrary off-the-shelf GPS trackers can send this handshake or connect without configuration. Many commercial trackers use vendor-specific login frames and need a dedicated adapter/session handler.

## Security and deployment
- The listener is plain TCP. Do not expose it directly to the public internet. Terminate TLS in a TCP-capable proxy or restrict it to a private APN/VPN/network segment.
- Use a unique token per enrolled device; revoke and re-enroll on compromise. Never log tokens.
- Enable `TRACKER_TCP_PORT` only when needed. Configure `TRACKER_TCP_HOST`, `TRACKER_TCP_MAX_CLIENTS` as appropriate.
- In a multi-replica deployment, each API replica may run its own listener; route device connections through a TCP load balancer. Sticky sessions are not required for this stateless per-connection auth profile, but a connection remains attached to one replica until disconnected.
- GT06 raw TCP login/ACK/session handling is not implemented by this listener. Existing GT06 support remains HTTPS frame ingestion only.

## Verification status
Static TypeScript syntax checks and script syntax checks are performed in this artifact. Full Nest build, live PostgreSQL ingestion, real TCP socket integration against a running Nest instance, TLS proxy validation, and physical tracker compatibility require the external runtime and hardware environment and are not represented as passed here.

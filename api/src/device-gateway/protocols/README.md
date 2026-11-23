# GPS protocol adapters

Parsers, stream framers, normalizers, and HTTPS adapters are separate layers.
No raw TCP socket is exposed by the API service. The existing credential-
authenticated tracker ingestion method remains the single path that writes
locations, evaluates alerts, and publishes latest positions.

## Device enrollment and profiles

Enroll a hardware tracker through authenticated `POST /api/v1/tracking/devices/gps`:

- `vehicleId` and optional `label`
- `protocol`: `json` (default), `gt06`, or `nmea`
- `imei`: unique hardware identifier (required for GT06 and NMEA profiles)
- `model`: optional model/profile label
- `timezoneOffsetMinutes`: required for GT06, minutes east of UTC (Jordan standard time is +180; daylight-saving devices must be configured for their actual local clock behavior)

The API returns a random device credential once. Only its SHA-256 hash is stored.
IMEI is unique across registered trackers. Device credentials remain the
authentication authority for incoming data; IMEI is metadata until a TCP
listener implements the model-specific login handshake.

## HTTPS ingestion

- Existing JSON: `POST /api/v1/device-gateway/ingest`
- NMEA: `POST /api/v1/device-gateway/ingest/nmea`, body `{ "sentence": "$GPRMC...*CS" }`
  with optional `pairedUtcTimestamp` for GGA. RMC uses its own UTC date/time.
- GT06: `POST /api/v1/device-gateway/ingest/gt06`, body `{ "frameHex": "7878..." }`.

All endpoints require the enrolled per-device Bearer credential and reject a
protocol that differs from the device's stored profile. GT06 uses that device's
timezone offset; no service-wide timezone setting is used. GGA requires a
trusted paired UTC timestamp. Only the classic 0x7878 or extended 0x7979 framing with the 0x12 GT06 location
profile is currently supported.

## TCP gateway boundary

Incremental stream decoders reassemble fragmented GT06 frames and NMEA CRLF
sentences, but do not open sockets, authenticate IMEI login packets, or send
protocol acknowledgements. A future public TCP relay must perform model-aware
IMEI authentication, bind the connection to this device registry, apply
connection/rate limits, and forward normalized payloads over HTTPS.

Render private services accept TCP only from Render's private network; they
are not public endpoints for GPS hardware. Do not deploy a raw GPS listener
there expecting internet-facing trackers.


## GT06 login/session primitives

The GT06 session helper decodes the common 0x01 BCD-IMEI login layout,
compares the decoded 15-digit IMEI to the registered device profile, and
builds the standard 0x7878 acknowledgement frame. It also requires an
authenticated session before accepting heartbeat (0x13) and location (0x12)
frames.

**Security limitation:** IMEI is an identifier, not a secret. The common GT06
login packet does not prove possession of the enrolled HTTPS bearer credential.
The session helper is therefore not a complete public authentication boundary.
Before exposing a raw TCP listener, deploy it behind a trusted APN/VPN or
device-source network controls, or add a verified model-specific device
authentication mechanism. Do not treat IMEI-only login as strong authentication.


## Device identity and enrollment conflicts

Hardware IMEI/device identifiers are globally unique in the tracking-device
registry. A second enrollment attempt for an already registered IMEI returns
HTTP 409 Conflict instead of an unhandled database error. The database unique
index remains the concurrency-safe source of truth. GT06 timezone normalization
uses the same -840..+840 minute range enforced by the enrollment DTO and schema.

# GPS protocol adapters

Parsers, stream framers, normalizers, and HTTPS adapters are separate layers.
No raw TCP socket is exposed by the API service. The existing credential-
authenticated tracker ingestion method remains the single path that writes
locations, evaluates alerts, and publishes latest positions.

## HTTPS ingestion adapters

- Existing JSON: `POST /api/v1/device-gateway/ingest`
- NMEA: `POST /api/v1/device-gateway/ingest/nmea`, body `{ "sentence": "$GPRMC...*CS" }`
  with optional `pairedUtcTimestamp` for GGA. RMC uses its own UTC date/time.
- GT06: `POST /api/v1/device-gateway/ingest/gt06`, body `{ "frameHex": "7878..." }`.
  Configure `GT06_TIMEZONE_OFFSET_MINUTES` as an integer minutes east of UTC.
  This initial setting is global to the service; use only when all connected
  devices share that timezone. A per-device timezone/profile registry is a
  prerequisite for multi-region fleets.

All three endpoints require the existing per-tracker Bearer credential.
The NMEA endpoint requires checksum validation and refuses GGA unless the
trusted relay supplies a paired UTC timestamp. The GT06 endpoint accepts only
the classic 0x7878 / 0x12 location profile implemented here.

## TCP gateway boundary

The incremental stream decoders reassemble fragmented GT06 frames and NMEA
CRLF sentences, but they do not open sockets, authenticate device IMEIs, or
send protocol acknowledgements. A future public TCP relay must perform those
tasks, map authenticated IMEIs to existing per-device credentials, and forward
normalized payloads over HTTPS to this API.

Render private services support arbitrary TCP only on the private network, not
from public GPS hardware. Render web services expose public HTTP(S) on one
port; additional ports are private-network only. Therefore do not deploy a raw
GPS listener as a Render private service expecting trackers on the internet.

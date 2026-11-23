# DARB GPS tracker API (HTTPS ingestion and TCP gateway)

The API routes below are relative to `https://darb-gps-x.onrender.com/api/v1`.
The examples use the current alpha API contract. Confirm that the target API
deployment includes the same commit before connecting live devices.

## 1. Enroll a tracker

A signed-in organization member with vehicle owner or manager rights calls:

`POST /tracking/devices/gps`

Minimum JSON-profile request:

```json
{
  "vehicleId": "VEHICLE_UUID",
  "label": "Truck GPS 01"
}
```

For a hardware profile, specify its protocol and device identity:

```json
{
  "vehicleId": "VEHICLE_UUID",
  "label": "Truck GT06 01",
  "protocol": "gt06",
  "imei": "123456789012345",
  "model": "GT06",
  "timezoneOffsetMinutes": 180
}
```

Supported profile values are `json` (default), `gt06`, and `nmea`.
GT06 requires an IMEI and a timezone offset in minutes. NMEA profiles use a
registered device identity and are mapped to a stable source IPv4 address at
the standalone TCP gateway.

Send the user's Supabase access token as
`Authorization: Bearer ACCESS_TOKEN`. The response contains a random tracker
credential exactly once. Store it in the physical device or gateway's protected
configuration. The server stores only its SHA-256 hash. Never put this
credential in source control, screenshots, support tickets, or client logs.

## 2. Send normalized JSON telemetry

`POST /device-gateway/ingest`

Headers:
- `Authorization: Bearer TRACKER_CREDENTIAL`
- `Content-Type: application/json`

Body:

```json
{
  "eventId": "OPTIONAL_UUID_FOR_RETRY_DEDUPLICATION",
  "latitude": 31.9539,
  "longitude": 35.9106,
  "speedKmh": 42.5,
  "heading": 90,
  "recordedAt": "2026-11-23T13:40:00.000Z"
}
```

Coordinates and timestamps are validated. Timestamps more than five minutes
in the future or older than seven days are rejected. If an event ID is supplied,
retries with the same event ID for the same vehicle are idempotent.

## 3. HTTPS protocol adapters

The API also exposes protocol-specific HTTPS adapters for trusted devices or
a relay that has already received and framed the device data:

- NMEA: `POST /device-gateway/ingest/nmea`, body
  `{"sentence":"$GPRMC...*CS"}`; a GGA sentence requires a trusted
  `pairedUtcTimestamp`.
- GT06: `POST /device-gateway/ingest/gt06`, body
  `{"frameHex":"7878..."}`; the enrolled profile's timezone offset is used.
- GT06 heartbeat: `POST /device-gateway/heartbeat/gt06`; updates last-seen
  without creating a location fix.

Each adapter requires the enrolled device's Bearer credential and rejects a
protocol that does not match the stored device profile. The current GT06 parser
supports the classic/extended frame formats documented in
`api/src/device-gateway/protocols/README.md` and the configured location
profile; this is not a claim of compatibility with every vendor-specific
tracker variant.

## 4. Standalone raw TCP gateway (separate deployment)

The Node TCP gateway under `gateway/gt06/` listens on TCP 5023 for GT06 and
TCP 5024 for configured NMEA devices. It decodes device streams, authenticates
GT06 IMEI login against its local enrolled-device map, applies per-device
source-IP checks, and forwards normalized/parsed telemetry to the HTTPS API
using each device's Bearer credential.

This TCP listener is **not hosted by the Render HTTP API service** and is not
automatically deployed with the API. It requires a separately provisioned
TCP-capable VPS, actual carrier APN/VPN egress CIDRs, provider firewall rules,
and real enrolled device credentials. Do not open these ports to the public
internet. GT06 IMEI is an identifier, not a cryptographic secret; use a private
APN/VPN and strict source-network allowlists. Follow
`gateway/gt06/deploy/README.md` before provisioning the listener.

The gateway's environment maps are loaded at startup. Restart it after device
enrollment, revocation, or credential rotation. A successful TCP connection or
simulator test alone does not prove physical tracker interoperability.

## 5. Read the latest position

A signed-in user with active membership in the vehicle calls:

`GET /tracking/vehicles/VEHICLE_UUID/latest`

The `/tracking` Socket.IO namespace also emits
`vehicle.location.updated` to authenticated members who joined the vehicle
room with `vehicle.join`.

## 6. Revoke a tracker

A vehicle owner or manager calls:

`POST /tracking/devices/gps/DEVICE_UUID/revoke`

A revoked credential can no longer ingest locations. Also remove or replace
that device's local gateway mapping and restart the standalone gateway so a
revoked device cannot continue to use a stale local configuration.

# DARB GPS tracker API (JSON HTTPS alpha)

All API URLs below are relative to `https://darb-gps-x.onrender.com/api/v1`.

## 1. Enroll a tracker

A signed-in organization member with vehicle owner or manager rights calls:

`POST /tracking/devices/gps`

```json
{
  "vehicleId": "VEHICLE_UUID",
  "label": "Truck GPS 01"
}
```

Send the user's Supabase access token as `Authorization: Bearer ACCESS_TOKEN`.

The response contains a random tracker credential exactly once. Store it in the physical device's protected configuration. The server stores only its SHA-256 hash. Do not put the credential in source control or client logs.

## 2. Send a location

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

Coordinates and timestamps are validated. Timestamps more than five minutes in the future or older than seven days are rejected. If an event ID is supplied, retries with the same event ID for the same vehicle are idempotent.

The initial gateway accepts normalized JSON telemetry. GT06, NMEA-0183, raw TCP and vendor-specific binary adapters are not part of this alpha gateway yet.

## 3. Read the latest position

A signed-in user with active membership in the vehicle calls:

`GET /tracking/vehicles/VEHICLE_UUID/latest`

The `/tracking` Socket.IO namespace also emits `vehicle.location.updated` to authenticated members who joined the vehicle room with `vehicle.join`.

## 4. Revoke a tracker

A vehicle owner or manager calls:

`POST /tracking/devices/gps/DEVICE_UUID/revoke`

A revoked credential can no longer ingest locations.

# Mobile device registry integration — alpha phase

The Vehicles screen now calls the authenticated endpoint `GET /api/v1/tracking/devices/vehicle/:vehicleId` and renders the devices already provisioned for the selected vehicle.

Displayed fields are limited to the device label/type, online/offline/never-connected status, manufacturer/model, last accepted protocol and reported battery percentage. The app does not expose tracker bearer credentials or the full IMEI/serial number.

Independent tracker provisioning remains an administrator/backend operation. The mobile app does not yet create tracker credentials, configure a physical tracker, or claim that every GT06/NMEA/JSON model is compatible. Compatibility depends on the exact device firmware, transport, framing, authentication and adapter profile. Device online status is based on the backend's two-minute last-seen window.

Validation required: provision a test `gps_tracker` device against a vehicle, call the endpoint with owner and non-member accounts, send authenticated tracker telemetry, and confirm the device status and telemetry update in the mobile list. These runtime checks require a configured PostgreSQL/backend environment and Flutter device build.

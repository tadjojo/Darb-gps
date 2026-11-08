# Phase 19 — Trip history API and mobile screen

- Added authenticated `GET /api/v1/tracking/vehicles/:vehicleId/trips` with strict ISO date range validation, a 31-day maximum window, and a 1–100 result cap.
- Trips are derived from ordered location points and split after 20 minutes of inactivity. Segmentation is partitioned by GPS device so points from a phone and an independent tracker are never interleaved into a false route.
- Each result includes start/end timestamps, point count, GPS polyline distance, average/maximum reported speed, device ID, and start/end coordinates.
- Added a seven-day trip-history request to the mobile API client and a bilingual trip list with refresh and a clear explanation of the derived distance/segmentation model.

Limitations: This is derived trip history, not a persisted trip entity or ignition-aware trip detector. Distance is the length of the GPS point-to-point line and may differ from road distance. Database integration against PostGIS and Flutter UI tests remain pending in a configured environment.

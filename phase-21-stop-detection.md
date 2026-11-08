# Phase 21 — GPS stop detection

## Delivered
- Added authenticated `GET /api/v1/tracking/vehicles/:vehicleId/stops?from=&to=&limit=` endpoint.
- Stop candidates use reported GPS speed at or below 3 km/h, a maximum 10-minute gap between consecutive readings, and no more than 100 m between consecutive positions.
- A stop is returned only when at least two readings span at least five minutes.
- Stop grouping is partitioned by tracking device to avoid mixing independent trackers.
- Response includes centroid coordinates, start/end times, dwell duration, point count, and the explicit detection thresholds.
- Mobile client loads the last seven days of trips and stops together and displays dwell summaries.

## Limitations
- Stops are inferred from GPS telemetry, not ignition or engine state. Low-speed congestion and GPS drift can affect classification.
- The current screen lists stops; selecting a stop does not yet open a dedicated map detail.
- Date windows remain capped at 31 days. The mobile view currently requests seven days.
- Run backend unit/integration tests and Flutter analysis/tests in CI before deployment. No production deployment is implied.

# Phase 20 — Historical trip route details

## Delivered
- Added authenticated `GET /api/v1/tracking/vehicles/:vehicleId/trip-route`.
- The endpoint applies the same vehicle membership/role authorization as trip history, filters by vehicle + device + bounded time range, and returns GPS coordinates in chronological order.
- Date windows are limited to 31 days. The query fetches at most 5,001 rows and rejects a response above 5,000 points to prevent unbounded map payloads.
- Added a mobile API client method and connected each trip row to its historical route.
- The map draws the selected trip as a distinct purple polyline and marks its start and end. The user can clear the historical overlay.
- Route rendering validates coordinates before creating map points.

## Data and security notes
- The route is reconstructed from the stored GPS events; it is not a road-snapped route.
- Access is checked against active vehicle membership. Historical records remain readable even if the originating tracker has since been revoked.
- The route request is scoped to the selected device so independent trackers are not interleaved.

## Verification
- Added unit tests for access-check flow, SQL scoping/order, date bounds, and point-count protection.
- Runtime Jest, database/PostGIS integration, Flutter analyze, and device tests require dependencies/toolchains not installed in the current build environment; they have not been executed here.

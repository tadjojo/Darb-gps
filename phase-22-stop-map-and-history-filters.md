# Phase 22 — Stop map pins and history filters

## Delivered
- Selecting a detected stop validates its latitude/longitude, opens the map, centers the camera at the stop, and displays an orange stop marker.
- The map shows a compact selected-stop panel with a clear action.
- Selecting a trip clears the selected stop, loads its route, and fits the camera to the route bounds rather than relying on a midpoint guess.
- Trip and stop history can be queried for 7, 14, or 30 days. The chosen range is sent to the existing authenticated API endpoints and refreshed together.
- Empty trip and empty stop states are independent; absence of trips no longer hides the stop list.
- Arabic and English labels are supported.

## Security and data handling
- No new API endpoint or permission bypass was introduced. Stop data continues to come from the authenticated vehicle-scoped endpoint, with existing 31-day server-side maximum and GPS-derived detection metadata.
- Map selection rejects non-finite and out-of-range coordinates before creating a marker.

## Verification
- Source-level checks cover the date filter, stop selection callback, marker, camera fitting, and independent empty states.
- ZIP archive integrity is checked when packaging. Flutter analyzer/widget tests and backend Jest tests are not run in this environment because Flutter/Dart and installed backend dependencies are unavailable.

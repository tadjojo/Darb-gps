# DARB navigation adapter — alpha phase

This phase adds a provider-isolated Dart service for place search and driving-route retrieval.

## Included

- `NavigationService.searchPlaces`: Nominatim-compatible place lookup, Arabic/English language preference, bounded result count, coordinate validation and explicit User-Agent.
- `NavigationService.getDrivingRoutes`: OSRM-compatible driving routes, optional alternatives, GeoJSON polyline conversion and distance/ETA metadata.
- Injectable HTTP client and provider base URLs for deterministic tests and later self-hosting/provider migration.
- Unit tests for valid/invalid geocoding results, empty query behavior, GeoJSON coordinate order and invalid route coordinates.

## Important limits

- This is a navigation data adapter, not yet a complete user-facing navigation screen. Turn-by-turn voice guidance, rerouting, map matching, offline map packages, traffic-aware ETA and route persistence remain subsequent work.
- Public Nominatim and OSRM demo services are not production infrastructure and have usage policies/rate limits. Configure an approved provider or self-hosted services before public rollout.
- Route geometry is returned as `LatLng` points for rendering as a `PolylineLayer`; this phase does not change the existing tracking/map screen.
- Run `flutter pub get`, `flutter analyze`, and `flutter test` in a Flutter SDK environment. They could not be executed in the current environment because Flutter/Dart are not installed.

## Map-screen integration

The map screen now uses this service for submitted place searches, displays matching suggestions, requests the current GPS fix when a route is selected and no current fix is cached, draws the selected route polyline, marks the destination, displays distance/estimated duration, and cycles through returned alternatives. The existing live-location marker and tracking controls remain in place.

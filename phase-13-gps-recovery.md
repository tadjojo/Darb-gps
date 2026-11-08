# Phase 13 — GPS stream recovery and location validation

## Implemented in source

- Tracking sessions carry a generation token so callbacks from an old stream cannot update a stopped or restarted session.
- GPS stream errors and normal completion schedule a bounded exponential retry (2, 4, 8, 16, 32, then 60 seconds).
- Pressing Stop invalidates the session and cancels a pending retry; no retry should restart user-stopped tracking.
- A single active subscription is maintained by cancelling the previous subscription before a replacement is created.
- Location fixes are rejected if coordinates are non-finite/out of range, accuracy is invalid or worse than 250 m, timestamp is older/newer than two minutes relative to device time, or timestamp is not newer than the last accepted fix.
- Android retains the visible Geolocator foreground notification configuration.

## Verification boundary

- Source inspection and archive integrity checks only. Flutter/Dart SDK are not installed in this environment, so `dart format`, `flutter analyze`, unit tests, Android compilation, and device tests have not been run.
- This is not a native process-survival guarantee. If Android kills the app process, this Dart-level retry logic cannot execute. A persistent native/OS-managed worker and real-device validation remain separate work.
- The two-minute timestamp check depends on the device clock being reasonably correct.

## Manual validation required

1. Start tracking, then simulate GPS stream loss; confirm retries occur with increasing delay.
2. Stop tracking during the retry delay; confirm no new stream starts.
3. Restart tracking; confirm only one stream remains active.
4. Inject invalid coordinates, poor accuracy, stale timestamps, and duplicate timestamps; confirm they are ignored.
5. Lock the screen, switch to airplane mode, restore connectivity, and verify queued uploads.

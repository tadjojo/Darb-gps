# Android background location tracking — phase 10

## Implemented in this source revision

- Android location stream uses Geolocator `AndroidSettings` with a foreground notification configuration.
- The notification remains ongoing while tracking is active and states that DARB location sharing is active.
- A wake lock is requested while the foreground location stream is active.
- The location stream requests a 5-second interval and 5-metre distance filter; Android, the device vendor, GPS conditions, and power policy may deliver less frequently.
- Android build scripts declare `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION`. The app uses a location foreground service started while the app is visible; it does not request the broader `ACCESS_BACKGROUND_LOCATION` permission in this phase.
- The service starts only after the user explicitly presses Start Tracking while the app is in the foreground.
- Pressing Stop Tracking cancels the location stream; the app does not start hidden tracking at boot.

## Important platform boundaries

- This is an Android foreground-service path supplied through the Geolocator plugin. It is not a guarantee of a location fix every five seconds.
- Android 13+ notification permission behavior must be verified on real devices. If notifications are denied, Android may limit where the foreground-service notification is displayed.
- The location foreground service must be started while the app is visible and the foreground location permission is already granted. Starting a location foreground service from the background has additional Android restrictions. Google Play distribution still requires a clear explanation of the user-visible tracking feature and compliance with foreground-service policy.
- Battery optimization, manufacturer task managers, revoked permissions, GPS reception, and network availability can delay or interrupt updates.
- The app currently queues points locally and retries uploads; the queue sync timer is not a substitute for a native persistent worker after the operating system kills the app process.
- iOS background tracking is not claimed as implemented by this phase. Apple background modes and Always authorization require a separate iOS implementation and physical-device validation.
- No Dart analyzer, Flutter build, Android emulator, or physical Android device was available in this environment. This source change is not compile-verified here.

## Required real-device test matrix

1. Grant while-in-use location permission, start tracking while the app is visible, and verify the ongoing DARB notification.
2. Press Home and lock the screen; verify points continue to arrive when GPS/network are available.
3. Switch to airplane mode; verify points queue locally, then upload after connectivity returns.
4. Stop tracking from the app; verify the location stream and notification stop.
5. Revoke location permission and repeat; verify tracking refuses to start.
6. Test Android 10, 11, 13, 14, and 15 where available, plus at least one aggressive battery-management vendor device.
7. Confirm battery drain, notification behavior, update cadence, and recovery after process termination.

## Privacy and consent

Tracking is user-started, visible through an ongoing notification, and stopped through the app. Do not add boot-start or covert tracking behavior. Provide a clear privacy notice before production release.

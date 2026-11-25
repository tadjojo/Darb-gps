# DARB GPS mobile release readiness

## Current application shape

- Flutter project at repository root (pubspec.yaml and lib/).
- One shared codebase targets Android and iOS.
- Arabic-first UI with an English language toggle.
- Existing app features include map display, place search and route calculation, account sign-in, organization/vehicle creation, mobile-device enrollment, location sharing, local pending-location queue, live socket updates, vehicle device list, trip history and route replay.
- The mobile client default API host is the Cloudflare Worker hostname: https://darb-gps-new.tadjojo.workers.dev.
- Previously stored legacy Render default is migrated to the Cloudflare hostname on next app launch. A deliberately configured custom API endpoint is retained.

## Security changes in this revision

- Production API URLs must use HTTPS.
- Plain HTTP is accepted only in debug builds for localhost, Android emulator loopback, and private development LAN addresses.
- API URLs containing user-info, query parameters, or fragments are rejected.
- Access and refresh tokens continue to use platform secure storage.
- Location fixes are validated for coordinate bounds, accuracy, freshness and monotonic timestamps before queueing.
- Each queued fix retains its UUID during retries so server-side idempotency can reject duplicate submissions.
- Tracking is explicitly user-started and stoppable; do not add covert tracking or boot-start behavior.

## Platform behavior and boundaries

### Android
- Active tracking uses a visible foreground location notification and requests a wake lock.
- The five-second interval is a requested interval, not a delivery guarantee.
- Background execution after force-stop, vendor battery termination, revoked permissions or reboot is not guaranteed by the current implementation.
- Google Play submission needs a policy declaration and review of location/foreground-service permissions.

### iOS
- Current supported behavior is foreground location tracking.
- CI injects an explicit NSLocationWhenInUseUsageDescription purpose string.
- Background location mode and Always authorization are intentionally not enabled yet. They require a separate implementation, clear in-app disclosure, correct native capabilities, battery testing and App Review compliance.
- iOS simulator build does not prove GPS behavior on a physical iPhone.

## Build automation

- The Android workflow generates the Android runner, installs dependencies, analyzes Dart, runs Flutter tests and builds a debug APK.
- The iOS workflow generates the iOS runner, adds the foreground location purpose string, analyzes Dart, runs Flutter tests and builds an unsigned simulator app.
- These workflows produce CI artifacts, not store-ready signed releases.

## Production release gates — not yet certified

1. Cloudflare API migration must be deployed and health-checked. The Worker hostname in the app is a target configuration, not proof that the API is currently live.
2. Backend auth, tenant/organization authorization, vehicle ownership, rate limits, location ingestion validation and audit logging must pass security tests.
3. Run Flutter analyzer and tests on CI; resolve every failure.
4. Install and test on physical Android devices across supported OS versions, including screen lock, permission denial/revocation, airplane mode, queue replay, battery behavior and stop-tracking behavior.
5. Install and test on physical iPhones for foreground GPS, permission changes, network loss/recovery, app lifecycle and battery behavior.
6. Implement and validate iOS background tracking only if it is required and accepted by the privacy and store policies.
7. Configure Android release signing with a private upload keystore stored only in protected CI secrets.
8. Configure Apple signing, provisioning profiles, App Store Connect metadata and privacy disclosures.
9. Publish privacy policy and support URLs, app account deletion flow, app screenshots, age/content declarations and store review credentials.
10. Perform an end-to-end acceptance test against the production API and database before public release.

## Honest status

The repository contains an existing Flutter mobile alpha and CI workflows. The changes above harden endpoint selection and CI configuration; they do not constitute a completed, signed, device-tested or store-approved release. No release artifact or production deployment is claimed until CI and physical-device acceptance tests pass.
# DARB mobile platform setup (alpha)

This archive contains the Flutter application source and `pubspec.yaml`, not a generated Android/iOS runner project and not an APK/IPA. Create the native runners once with Flutter installed:

```bash
cd mobile
flutter create --platforms=android,ios .
flutter pub get
```

## Android permissions

Add these inside the top-level `<manifest>` in `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

Do not add background-location or boot-start permissions for this alpha. Tracking is intentionally foreground-only.

## iOS permissions

Add these keys to `ios/Runner/Info.plist` with clear localized purpose strings:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>يستخدم دَرْب موقعك أثناء تشغيل التتبع الذي تبدأه بنفسك.</string>
```

Do not add `UIBackgroundModes` location until the background tracking flow, visible indicators, App Store disclosures and device tests are implemented.

## Configure and run

```bash
flutter pub get
flutter run
```

For Android emulator, the default API URL is `http://10.0.2.2:3000`. For a physical phone, enter the computer's reachable LAN address in the app settings. Production must use HTTPS.

## Backend account prerequisite

The NestJS alpha intentionally has no public signup/password-reset endpoint. An administrator must provision an active user with a bcrypt password hash (see the backend `docs/bootstrap-first-vehicle.sql`). The app can then sign in, create an organization and vehicle, enroll this phone, and begin foreground tracking.

## Location delivery semantics

Each GPS fix gets a UUID once and is stored in SQLite before network transmission. Retries reuse the same `eventId`, so the API's `(device_id,event_id)` uniqueness constraint prevents duplicate location inserts. The app refreshes short-lived access tokens using its rotating refresh token and reconnects the socket. After a socket reconnect it fetches the REST latest-location endpoint to reconcile missed events. Socket events are deduplicated by `eventId`/`outboxId`.

The configured `distanceFilter` is 5 metres; this is not a guaranteed five-second update interval. Operating-system scheduling, permissions, accuracy, battery policy and connectivity govern actual update cadence.

## Android APK build (v8 build handoff)

The source archive now includes repeatable build scripts:

Linux/macOS:

```bash
cd mobile
chmod +x scripts/build-android.sh
./scripts/build-android.sh
```

Windows PowerShell:

```powershell
cd mobile
.\scripts\build-android.ps1
```

The script generates the official Flutter Android runner if it is absent, adds only INTERNET and foreground location permissions, resolves packages, runs `flutter analyze` and `flutter test`, then builds a release APK. Output (if all checks pass):

`mobile/build/app/outputs/flutter-apk/app-release.apk`

Prerequisites: Flutter stable, Android Studio/Android SDK, accepted Android SDK licenses, Java version supported by the Flutter-generated Gradle project, and network access for first-time package resolution. The release APK produced by this generic command is not a Play Store-signed production release. Configure a private upload keystore and Gradle signing properties before distribution.

## Backend connection before field use

The default `http://10.0.2.2:3000` URL is for the Android emulator only. On a physical phone, configure the reachable backend URL in Settings; production must use a publicly trusted HTTPS endpoint. The backend must be deployed, migrations applied, and an administrator-provisioned user/vehicle available. Do not expose the development API over the public internet.

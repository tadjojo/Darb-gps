#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v flutter >/dev/null 2>&1; then
  echo "ERROR: Flutter SDK is not installed or not on PATH." >&2
  echo "Install Flutter stable and Android Studio/Android SDK, then run this script again." >&2
  exit 2
fi

flutter --version
flutter doctor -v

# Generate the official native Android runner while preserving lib/ and pubspec.yaml.
if [[ ! -f android/app/src/main/AndroidManifest.xml ]]; then
  flutter create --platforms=android --org com.darb --project-name darb_gps .
fi

MANIFEST="android/app/src/main/AndroidManifest.xml"
python3 - "$MANIFEST" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
permissions = [
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
    '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />',
]
marker = '<application'
if marker not in s:
    raise SystemExit('AndroidManifest.xml has no <application> element')
missing = [x for x in permissions if x.split('name="')[1].split('"')[0] not in s]
if missing:
    s = s.replace(marker, '\n'.join(missing) + '\n    ' + marker, 1)
p.write_text(s)
PY

flutter pub get
flutter analyze
flutter test
flutter build apk --release

APK="$ROOT/build/app/outputs/flutter-apk/app-release.apk"
if [[ ! -s "$APK" ]]; then
  echo "ERROR: Flutter reported success but APK was not found at $APK" >&2
  exit 3
fi
sha256sum "$APK"
echo "APK created: $APK"

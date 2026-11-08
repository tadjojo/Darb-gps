# Android hosted-build handoff

## Added
- GitHub Actions workflow: `.github/workflows/android-debug-apk.yml`.
- Manual workflow dispatch and automatic runs for changes under `mobile/`.
- Flutter stable toolchain, Java 17, dependency resolution, `flutter analyze`, `flutter test`, and debug APK build.
- APK existence check, SHA-256 output, and 14-day artifact retention.

## What this enables
Once the repository is pushed to GitHub and Actions are enabled, GitHub-hosted Linux runners can build an installable Android **debug** APK without requiring Flutter or Android SDK on the user's own computer.

## What has not happened
- No GitHub repository was created or accessed from this environment.
- The workflow has not been executed.
- No APK has been generated or device-tested in this environment.
- No production release signing key has been created.
- No Google Play publication has occurred.

## Required next external step
Push the complete project directory to a private or public GitHub repository, then run the workflow from the Actions tab. The first successful run must be reviewed for compiler/test errors before distributing its APK.

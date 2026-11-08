# Phase 17 — Device registry hardening

This phase fixes a concrete API defect found during source inspection: the metadata update service previously interpolated DTO property names such as `modelName` and `serialNumber` into SQL, while the schema uses PostgreSQL names such as `model_name` and `serial_number`. The update now uses a fixed allowlist mapping, preventing invalid-column errors and preventing dynamic column-name injection.

The vehicle device-list query now omits IMEI and serial number because the mobile fleet list does not need those identifiers. Empty metadata updates return HTTP 400. Unit tests were added for the mapping, empty patch behavior, minimization of returned device identity data, and vehicle membership enforcement.

Validation: ZIP integrity and source-level assertions passed. Flutter/Dart and backend dependencies are not installed in this environment; Flutter tests, Jest, TypeScript build, Android APK build, and physical-device tests remain unexecuted.

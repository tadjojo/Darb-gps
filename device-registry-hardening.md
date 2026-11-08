# Device registry hardening — phase 17

## Changes

- Metadata updates now use a fixed DTO-to-database column allowlist. Public camelCase fields map to the actual PostgreSQL snake_case columns (`modelName` → `model_name`, etc.).
- Empty metadata patches return HTTP 400 rather than HTTP 403.
- Vehicle device-list responses no longer select or expose IMEI and serial number. Those identifiers remain available only through the owner/manager metadata-update response path and should be further restricted if role-specific read access is added.
- Unit tests cover SQL column mapping, empty updates, list-field minimization, and vehicle membership enforcement.

## Verification status

The source and tests were reviewed and packaged. Jest/TypeScript execution was not performed in this environment because the backend dependencies are not installed. Run `npm ci`, `npm run test:unit`, and `npm run build` in the backend directory before deployment.

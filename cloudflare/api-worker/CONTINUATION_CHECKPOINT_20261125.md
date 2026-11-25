# DARB GPS — Continuation checkpoint (2026-11-25)

## Verified build outputs
- GitHub branch: `cloudflare-free-api-migration-next`
- Draft pull request: #46 — https://github.com/tadjojo/Darb-gps/pull/46
- Head commit at this checkpoint: `899956fb0f5dc4ae511a527ae6c994780026cf71`
- Android debug workflow: successful; split ABI artifact `darb-gps-android-debug-split` generated (arm64-v8a, armeabi-v7a, x86_64).
- iOS simulator workflow: successful.
- Worker test/dry-run validation: successful (49 tests).
- Flutter validation/analyzer/test and smoke checks: successful. Note the smoke check remains the legacy Render baseline; it does not test a deployed Cloudflare Worker.
- Cloudflare Git-connected builds for the four existing Worker services failed. Dashboard logs are account-gated and have not been independently inspected.

## Installable Android artifact
CI artifact generated for the branch head. Architecture-specific APKs are produced. For most current Android phones, use the arm64-v8a APK. This is a debug APK and is not release-signed.

## Remaining launch blockers
1. Resolve Cloudflare build configuration for existing Workers (build logs needed from authenticated dashboard).
2. Deploy the new Worker as staging service `darb-gps-free-api`, not as a production replacement.
3. Configure Supabase URL, publishable key, service-role secret, and allowed origins using Cloudflare secrets/settings; never commit credentials.
4. Apply the staged SQL migrations to a disposable/staging Supabase project and run integration tests.
5. Verify authentication, org/vehicle membership, location writes, tracker provisioning/ingestion, alerts, history, CORS and unauthorized requests end-to-end.
6. Complete a security review (credential lifecycle, rate limits, tenant isolation, request validation, logging redaction).
7. Test Android and iOS app against staging, then prepare a controlled cutover and rollback.
8. Build release APK/AAB with production signing only after staging acceptance.

## Guardrails
- No production DB migrations have been applied by this branch.
- No Cloudflare deployment has been made by this branch.
- Production Flutter API endpoint remains unchanged.
- Keep PR #46 in draft until staging verification and review are complete.
- TCP tracker ingestion is not supported by Workers Fetch; raw TCP gateway design remains a separate component. HTTPS JSON/GT06/NMEA adapters are implemented in this staging prototype.


## Security hardening added in latest continuation
- Added baseline API response security headers (nosniff, no-referrer, deny framing, restrictive CSP) and no-store.
- Added an early request declared-size guard: requests with Content-Length above 64 KiB receive HTTP 413.
- Added dedicated tests for headers and the size guard. CI is pending for head commit `81e863b0f0e92e7f5f902cf8659cf68cc99519d4` at time of checkpoint.
- The size guard relies on Content-Length; streaming body enforcement for requests that omit or misreport it is still a future hardening item.

## Follow-up security review
- Corrected the Content-Security-Policy header to use valid quoted `'none'` directives in both preflight and JSON responses.
- Updated the security test to assert the exact restrictive CSP header.
- Current CI for commit `dd25752bcaafd925960cc2eff8632c6f9df4e1dc`: Worker validation in progress, Android in progress, iOS queued, smoke test passed.
- Earlier four Cloudflare Git service build checks remain failures (`darb-gps-2026`, `darb-gps-new`, `darb-gps`, `darb-gps-web-2026`). Their protected build logs still need to be inspected by the account owner.

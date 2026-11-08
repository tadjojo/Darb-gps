# Phase 5459 — Explicit access-token revocation

## Implemented in source
- Logout revokes the presented refresh session and, if a valid Bearer access token is supplied, stores its JWT `jti` and expiry in `revoked_access_tokens`.
- HTTP JWT guard checks the JTI revocation table as well as active account status.
- New Socket.IO connections reject revoked JTIs.
- Flutter logout sends the current access token in the Authorization header and clears local tokens regardless of network outcome.
- Initial migration creates the revocation table and expiry index; rollback drops it.

## Validation performed
- TypeScript syntax transpilation: 32 source files, zero syntax diagnostics.
- Migration JavaScript `node --check`: passed.
- `package.json` JSON parse: passed.
- Runtime database, HTTP, and Socket.IO acceptance tests were not run because the environment does not have the app dependencies or a running PostgreSQL/Redis stack.

## Known limitation
A socket that was already connected before logout remains connected until it disconnects. Distributed revocation fanout and membership revalidation are still required before production. Expired JTI row cleanup must also be scheduled operationally.

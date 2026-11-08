# DARB deployment and acceptance runbook

This is an operational checklist for the alpha stack. It is not a claim that a production environment has already been deployed.

## 1. Prepare the host

- Use a supported Linux server with Docker Engine and the Docker Compose plugin.
- Allocate persistent storage for PostgreSQL and Redis, configure monitoring, and restrict SSH access.
- Do not expose PostgreSQL (5432), Redis (6379), or the API's internal ports directly to the public internet.
- Put a TLS reverse proxy / load balancer in front of port 8080 before sending credentials or location data over the internet. The included Nginx profile listens on HTTP and is intended for a private host or a TLS-terminating proxy in front of it.

## 2. Configure secrets

```bash
cd backend
cp .env.example .env
openssl rand -hex 32
```

Set distinct, randomly generated values for `POSTGRES_PASSWORD` and `JWT_ACCESS_SECRET`. Set `CORS_ORIGINS` to the exact trusted web origins; do not use a wildcard with credentialed requests. Keep `.env` out of source control and backups shared with the app package.

## 3. Start the stack

```bash
./scripts/deploy-multi-instance.sh
./scripts/check-stack.sh
```

The deployment helper starts PostgreSQL and Redis, applies migrations, then starts two API instances and Nginx. The readiness endpoint checks the database and Redis connections. This sample still uses a single PostgreSQL instance and a single Redis instance; two API containers do not make the data tier highly available.

## 4. Configure the Android app

The default `http://10.0.2.2:3000` address is for the Android emulator only. For a physical phone, configure the API URL in the app's settings to the reachable HTTPS endpoint, for example `https://gps.example.com`. The phone and server must have network reachability. Never use the emulator alias on a physical device.

## 5. Acceptance checklist before pilot

- Create an authorized test account and verify login, refresh, and logout.
- Enroll one test vehicle and one independent tracker; verify device-to-vehicle binding and protocol credential isolation.
- Send JSON and NMEA test messages; verify timestamp, coordinates, speed, duplicate handling, and rejection of invalid credentials.
- Verify live map updates, history, trip segmentation, stops, route display, and reconnect after network loss.
- Verify organization/vehicle access boundaries with two separate test accounts.
- Verify audit logs, retention policy, backup restoration, alert delivery, and HTTPS certificate renewal.
- Run the backend CI workflow and Android workflow; install the resulting APK on at least one physical Android device and record the test results.

## 6. Database backup

```bash
./scripts/backup-postgres.sh
```

Copy the resulting custom-format dump to a separate protected storage location. A backup is not validated until a restore has been tested on a separate database/server.

## 7. Android build

Push the repository to a GitHub repository, enable Actions, then run `DARB Android debug APK`. Download the `darb-gps-android-debug-*` artifact from the completed workflow. This is a debug/test build, not a Play Store release. A production release requires a protected signing key, release build configuration, privacy review, and store compliance work.

## Local tracker simulator smoke test

The dependency-free simulator test starts a local mock receiver, sends three unique GPS events plus three deliberate duplicate transmissions, and verifies that the receiver sees six requests but only three unique payloads:

```bash
npm run test:simulator
```

This validates the simulator and retry/duplicate test harness only; it does not replace integration tests against the running DARB API or a physical GPS tracker.

### CI simulator check (v27)

The backend GitHub Actions workflow runs `npm run test:simulator` before dependency installation. This starts a local mock HTTP receiver and verifies that the independent JSON tracker simulator sends three unique readings and three exact replays. It is a transport/simulator smoke test only; it does not prove live API authentication, database persistence, protocol interoperability with physical devices, or production readiness.

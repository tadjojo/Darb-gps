# Deploy DARB GPS TCP Gateway on a TCP-capable VPS

This deployment target is for GPS hardware that must initiate raw TCP connections
from a carrier private APN, VPN, or stable trusted egress IP range. It is not a
Render public web service deployment.

## 1. Network prerequisites — do these before opening ports

Obtain the actual public egress IPv4 CIDR(s) used by the SIM provider's private
APN/VPN. Do not assume the SIM's private address is the source address visible
to the VPS. Ask the carrier for the egress/NAT ranges and confirm them with a
test SIM.

At the VPS provider firewall, configure:

- Allow TCP 5023 only from the confirmed GT06 APN/VPN egress CIDR(s).
- Allow TCP 5024 only from confirmed NMEA source CIDR(s), if NMEA is used.
- Deny TCP 5023 and 5024 from all other sources.
- Keep SSH access restricted to your own administration IP range.
- Do not expose Postgres, Supabase, or the DARB API database port.

The process also enforces `TRUSTED_DEVICE_CIDRS`; the provider firewall is an
additional independent layer. Do not use `0.0.0.0/0`. IMEI is an identifier,
not a cryptographic secret, and the tracker-to-gateway GT06 link is not
encrypted by this adapter. Use a private APN/VPN.

## 2. Install Docker

Use a supported Ubuntu LTS VPS image. Install Docker Engine and the Compose
plugin using Docker's official instructions:
https://docs.docker.com/engine/install/ubuntu/

Do not run unrelated workloads or expose the Docker daemon to the internet.

## 3. Configure credentials

From the repository root:

```sh
cd gateway/gt06/deploy
cp .env.example .env
chmod 600 .env
nano .env
```

Replace the sample CIDR with the actual trusted carrier egress range(s). Replace
the sample IMEI and bearer token with the actual device profile and one-time
credential produced by the DARB GPS device enrollment flow.

For more than one device, add each IMEI as another JSON object entry in
`GT06_DEVICE_MAP_JSON`. Every entry must include its own `sourceCidrs` list
with the carrier egress IP range(s) assigned to that specific SIM/device, in
addition to its own bearer credential. A broad shared APN CIDR is only the
outer network boundary; per-device source CIDRs prevent one SIM on the same APN
from claiming another device IMEI. Do not reuse credentials across devices.

For NMEA, uncomment and configure `NMEA_DEVICE_MAP_JSON` with each device's
static source IPv4 address and its own enrolled NMEA bearer credential. NMEA
has no IMEI login, so source-IP-to-device mapping must be unique and stable.

Never paste credentials into GitHub issues, source files, or chat. Never commit
the local `.env` file.

## 4. Build and start

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 darb-gps-tcp-gateway
```

The image runs as the unprivileged Node user, has a read-only root filesystem,
drops Linux capabilities, and applies container resource limits. The service
restarts automatically after host/container restarts.

## 5. Verify with the carrier

Ask the carrier to route one test SIM through the configured private APN/VPN.
Verify that its source address matches the allowlist and that it can connect to
TCP 5023 (GT06) or 5024 (NMEA). Confirm a real tracker login and location appears
in DARB before enabling a fleet. A TCP port-open check alone does not prove that
the protocol, device credential, timezone, or vehicle assignment is correct.

Useful commands:

```sh
docker compose logs -f darb-gps-tcp-gateway
docker compose restart darb-gps-tcp-gateway
docker compose down
```

## 6. Operational limitations

- The gateway forwards to DARB using HTTPS; the API and Supabase remain on the
  existing managed services.
- The gateway configuration currently loads the device credential maps at
  startup. Restart the service after enrolling, revoking, or rotating a device
  credential.
- On SIGTERM/SIGINT the gateway stops accepting new connections, allows a
  five-second drain window, then closes remaining tracker sockets so container
  shutdown cannot hang indefinitely.
- At startup, GT06 per-device CIDRs must be fully contained in the trusted
  APN/VPN ranges, NMEA static source IPs must be inside those ranges, and each
  enrolled device must have a unique bearer token.
- GT06 timezone offset must be set correctly in the device profile before
  location ingestion.
- NMEA GGA records are forwarded only when paired with a matching RMC time
  from the same TCP connection.
- No physical tracker, carrier APN, VPS, or provider firewall was provisioned
  by this repository change. Those external resources require their own
  accounts and carrier details.

# DARB GPS GT06 TCP Gateway

This standalone raw-TCP adapter supports GT06/Concox trackers and NMEA 0183
feeds. It authenticates registered devices and forwards accepted location data
to the DARB HTTPS API.

## Network boundary

This gateway requires inbound raw TCP. It cannot be deployed as an ordinary
HTTP Worker or on a `workers.dev` hostname. Cloudflare Spectrum can route TCP
to a Worker/Container on an eligible custom zone and paid plan; the current
Worker-origin TCP feature is a public beta. Until that is provisioned, use a
TCP-capable host on a trusted APN/VPN. Do not expose IMEI-only authentication
to the public internet.

## Build

Run from the repository root:

```sh
docker build -f gateway/gt06/Dockerfile -t darb-gt06-gateway .
```

## Runtime configuration

Set credentials in the deployment platform's secret manager; never commit
device bearer credentials.

- `DARB_API_BASE_URL`: `https://darb-gps-new.tadjojo.workers.dev/api/v1`
- `GT06_PORT`: optional, defaults to `5023`
- `NMEA_PORT`: optional, defaults to `5024`
- `NMEA_DEVICE_MAP_JSON`: optional JSON object keyed by trusted static source IPv4 address
- `TRUSTED_DEVICE_CIDRS`: required trusted IPv4 CIDR ranges from private APN/VPN
- `GT06_DEVICE_MAP_JSON`: required JSON object keyed by 15-digit IMEI, with unique bearer credentials and per-device `sourceCidrs`

Do not use `0.0.0.0/0` for trusted CIDRs. Each device must be restricted to
its own source range. Bearer credentials must be unique and stored outside Git.

## Data flow

1. The tracker connects over a trusted TCP transport.
2. The gateway validates the GT06 login and packet frames.
3. Heartbeat and location packets are sent to the Cloudflare-hosted DARB API
   over HTTPS using the enrolled device credential.
4. The gateway acknowledges a GT06 location only after the API accepts it.

Cloudflare API base URL:
`https://darb-gps-new.tadjojo.workers.dev/api/v1`

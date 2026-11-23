# DARB GPS GT06 TCP Gateway

This is a standalone raw-TCP adapter for GT06/Concox trackers. It reassembles
0x7878/0x7979 frames, authenticates the login IMEI against an explicitly
enrolled-device allowlist, acknowledges heartbeat frames, and forwards location
frames to the existing authenticated DARB HTTPS ingestion endpoint.

## Important network security requirement

GT06 login commonly exposes the IMEI, which is an identifier and not a secret.
This gateway therefore refuses to start without `TRUSTED_DEVICE_CIDRS` and
rejects TCP connections whose source IPv4 address is outside those ranges.
Deploy only behind a private cellular APN, site-to-site VPN, or a carrier
connection with stable source addresses and firewall restrictions. Do not set
`0.0.0.0/0` as a convenience. The device-to-gateway GT06 connection itself is
not encrypted by this adapter; use a trusted private transport network.

Render Private Services can accept arbitrary TCP only from Render's private
network; they do not provide public raw-TCP ingress for GPS devices. This
container is intended for a TCP-capable VM/VPS or a trusted private network
gateway. The DARB API remains on Render and receives HTTPS requests.

## Build

Run from the repository root:

```sh
docker build -f gateway/gt06/Dockerfile -t darb-gt06-gateway .
```

## Runtime configuration

Set the following environment variables in the deployment platform's secret
manager. Never commit the device bearer credentials to Git.

- `DARB_API_BASE_URL`: `https://darb-gps-x.onrender.com/api/v1`
- `GT06_PORT`: optional, defaults to `5023`
- `TRUSTED_DEVICE_CIDRS`: comma-separated trusted IPv4 CIDR ranges from the
  private APN/VPN. Required.
- `GT06_DEVICE_MAP_JSON`: JSON object keyed by 15-digit IMEI. Each entry
  contains the one-time bearer credential copied from the DARB device
  enrollment screen.

Example shape (replace placeholders in the host's secret manager):

```json
{
  "123456789012345": {
    "bearerToken": "PASTE_THE_ONE_TIME_DEVICE_CREDENTIAL_HERE"
  }
}
```

Optional capacity settings:
- `MAX_CONNECTIONS`: defaults to 500, allowed 1–5000
- `IDLE_TIMEOUT_MS`: defaults to 120000, allowed 10000–3600000

## Data flow

1. A device opens a TCP connection from a trusted APN/VPN source address.
2. The gateway reassembles stream frames and accepts only a registered IMEI
   login packet.
3. Heartbeat packets refresh the device's last-seen state through the
   authenticated `POST /device-gateway/heartbeat/gt06` API.
4. Location packets are forwarded as original frame hex to
   `POST /device-gateway/ingest/gt06`; the API validates the enrolled device
   bearer credential, protocol, CRC, timestamp, and configured device timezone.
5. A location ACK is sent only after the API accepts the fix.

The bearer token is held only by the gateway and is never sent to the tracker.
Unknown IMEIs, untrusted source addresses, packets before login, API failures,
and malformed frames close the TCP session.

## Deployment boundary

The repository does not contain a public TCP hosting account or carrier APN
configuration. Building this image does not itself expose a public port. A
TCP-capable host and trusted network path must be provisioned before trackers
can connect from the field.

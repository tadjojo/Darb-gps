# DARB GPS GT06 TCP Gateway

This is a standalone raw-TCP adapter for GT06/Concox trackers and NMEA 0183
feeds. It reassembles 0x7878/0x7979 GT06 frames, authenticates GT06 login IMEI
against an enrolled-device allowlist, and forwards heartbeat/location packets
to DARB over HTTPS. Its optional NMEA listener maps a trusted static source IP
to an enrolled NMEA device and forwards checksum-validated RMC/GGA sentences.

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
- `NMEA_PORT`: optional, defaults to `5024`; listener starts only when NMEA device mappings are configured
- `NMEA_DEVICE_MAP_JSON`: optional JSON object keyed by each NMEA device's static source IPv4 address. Each entry contains its one-time DARB bearer credential.
- `TRUSTED_DEVICE_CIDRS`: comma-separated trusted IPv4 CIDR ranges from the
  private APN/VPN. Required. Each GT06 device entry must also define its own
  non-empty `sourceCidrs` list; a shared APN range alone does not bind an IMEI
to a particular SIM/device.
- `GT06_DEVICE_MAP_JSON`: JSON object keyed by 15-digit IMEI. Each entry
  contains the one-time bearer credential copied from the DARB device
  enrollment screen.

Example shape (replace placeholders in the host's secret manager):

```json
{
  "123456789012345": {
    "bearerToken": "PASTE_THE_ONE_TIME_DEVICE_CREDENTIAL_HERE",
    "sourceCidrs": ["10.20.30.41/32"]
  }
}
```

Optional capacity settings:
- `MAX_CONNECTIONS`: defaults to 500, allowed 1–5000
- `IDLE_TIMEOUT_MS`: defaults to 120000, allowed 10000–3600000

### NMEA device map example

```json
{
  "10.20.30.41": {
    "bearerToken": "PASTE_THE_ONE_TIME_NMEA_DEVICE_CREDENTIAL_HERE"
  }
}
```

NMEA 0183 sentences do not carry an IMEI login. The source IP must therefore be
static and uniquely mapped to one enrolled NMEA device inside the trusted APN/VPN.

## Data flow

1. A device opens a TCP connection from a trusted APN/VPN source address.
2. The gateway reassembles stream frames and accepts only a registered IMEI
   login packet.
3. Heartbeat packets refresh the device's last-seen state through the
   authenticated `POST /device-gateway/heartbeat/gt06` API.
4. Location packets are forwarded as original frame hex to
   `POST /device-gateway/ingest/gt06`; the API validates the enrolled device
   bearer credential, protocol, CRC, timestamp, and configured device timezone.
5. A GT06 location ACK is sent only after the API accepts the fix. NMEA has no corresponding ACK; RMC is forwarded with its UTC timestamp, and GGA is forwarded only when its UTC time-of-day matches the latest RMC from that same connection.

The bearer token is held only by the gateway and is never sent to the tracker.
Unknown IMEIs, untrusted source addresses, packets before login, API failures,
and malformed frames close the TCP session.

## Deployment boundary

The repository does not contain a public TCP hosting account or carrier APN
configuration. Building this image does not itself expose a public port. A
TCP-capable host and trusted network path must be provisioned before trackers
can connect from the field.

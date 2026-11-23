# GPS protocol adapters

The parsers and normalizers in this folder are pure decoding helpers. They do
not open sockets, authenticate devices, write locations, or acknowledge tracker
packets. The existing credential-authenticated HTTPS JSON ingestion endpoint
remains the only ingestion path until a separately secured TCP gateway is built.

## NMEA 0183

Supported sentences: GPRMC/GNRMC and GPGGA/GNGGA. Checksums are mandatory.
RMC supplies UTC date/time and motion; GGA supplies fix quality, satellites,
altitude, and coordinates but has no date. A GGA fix must be paired with a
trusted UTC timestamp from the same device stream/session before ingestion.
The normalizer never substitutes server time.

## GT06

The first implementation supports classic 0x7878 short frames, CRC-ITU
validation, and the common 0x12 location payload. It intentionally does not
claim support for 0x7979 extended frames, vendor-specific location layouts,
terminal-ID-prefixed location packets, alarms, or every GT06-branded device.
The six-byte device clock is interpreted only using an explicitly configured
fixed UTC offset in minutes. Regions with daylight-saving changes must resolve
the offset for the actual recorded date in the device profile.

## Production integration

A future TCP gateway must bind authenticated device identity to a configured
model profile, parse stream framing (including partial/multiple frames),
perform the required protocol acknowledgements, and forward normalized fixes
through the existing credential-authenticated HTTPS ingestion path. Do not
expose an unauthenticated raw socket or assume an HTTP service accepts raw TCP.

# GPS protocol adapters

The parsers in this folder are pure decoding helpers. They do not open sockets,
authenticate devices, write locations, or acknowledge tracker packets.

## NMEA 0183

Supported sentences: GPRMC/GNRMC and GPGGA/GNGGA. Checksums are mandatory.
RMC supplies UTC date/time and motion; GGA supplies fix quality, satellites,
altitude, and coordinates but has no date. A GGA fix must be paired with a
trusted date/time source before ingestion.

## GT06

The first implementation supports classic 0x7878 short frames, CRC-ITU
validation, and the common 0x12 location payload. It intentionally does not
claim support for 0x7979 extended frames, vendor-specific location layouts,
terminal-ID-prefixed location packets, alarms, or every GT06-branded device.
The six-byte device clock is returned as components because timezone behavior
varies by model and configuration; do not silently interpret it as UTC.

Before production ingestion, bind each authenticated device to an explicitly
configured model profile and timezone, then pass normalized fixes through the
existing credential-authenticated HTTPS ingestion path. Raw TCP listener
deployment is a separate hosting decision and is not part of the Render HTTP
API service.

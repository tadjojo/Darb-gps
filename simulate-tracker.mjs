#!/usr/bin/env node
// DARB independent GPS tracker simulator. Node.js 20+ (built-in fetch).
import fs from 'node:fs/promises';
import process from 'node:process';

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--')
  ? [v.slice(2), a[i + 1]?.startsWith('--') || a[i + 1] === undefined ? 'true' : a[i + 1]] : null).filter(Boolean));
const required = ['url', 'credential', 'protocol'];
for (const key of required) if (!args[key]) {
  console.error(`Missing --${key}. Example: node scripts/simulate-tracker.mjs --url http://localhost:3000/api/v1/device-gateway/ingest --credential <secret> --protocol json`);
  process.exit(2);
}
if (!['json', 'nmea0183', 'gt06'].includes(args.protocol)) throw new Error('protocol must be json, nmea0183 or gt06');

function nmeaPayload() {
  const now = new Date();
  const time = [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()].map(x => String(x).padStart(2, '0')).join('');
  const date = [now.getUTCDate(), now.getUTCMonth() + 1, now.getUTCFullYear() % 100].map(x => String(x).padStart(2, '0')).join('');
  // Example position near Amman; replace with --payload-file for a field capture.
  const body = `GPRMC,${time}.00,A,3157.0000,N,03556.0000,E,12.0,90.0,${date},,,A`;
  let checksum = 0; for (const c of body) checksum ^= c.charCodeAt(0);
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, '0')}`;
}
async function makePayload() {
  if (args['payload-file']) return (await fs.readFile(args['payload-file'], 'utf8')).trim();
  if (args.protocol === 'json') return JSON.stringify({ latitude: 31.95, longitude: 35.91,
    speedKmh: 12, heading: 90, accuracyMeters: 8, recordedAt: new Date().toISOString(),
    batteryPercent: 87, signalStrengthDbm: -76, networkType: 'LTE' });
  if (args.protocol === 'nmea0183') return nmeaPayload();
  throw new Error('GT06 requires --payload-file containing a valid hexadecimal location frame');
}

const endpoint = args.url;
const attempts = Math.max(1, Number(args.retries ?? 3));
const delayMs = Math.max(0, Number(args['delay-ms'] ?? 1000));
const repeat = Math.max(1, Math.min(100000, Number(args.repeat ?? 1)));
const intervalMs = Math.max(0, Math.min(3600000, Number(args['interval-ms'] ?? 5000)));
async function send(label, payload) {
  const body = JSON.stringify({ protocol: args.protocol, payload });
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: {
        'content-type': 'application/json', authorization: `Bearer ${args.credential}` }, body });
      const text = await response.text();
      console.log(`${label} attempt=${attempt} status=${response.status} response=${text}`);
      if (response.ok) return true;
      if (response.status >= 400 && response.status < 500) return false;
    } catch (error) { console.log(`${label} attempt=${attempt} network_error=${error.message}`); }
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}
if (args['simulate-drop-first'] === 'true') {
  console.log('SIMULATED_NETWORK_DROP: first send intentionally suppressed; next send represents retry after reconnection');
  await new Promise(resolve => setTimeout(resolve, delayMs));
}
for (let index = 0; index < repeat; index++) {
  const payload = await makePayload();
  const ok = await send(`event=${index + 1}/${repeat}`, payload);
  if (ok && args.duplicate === 'true') await send(`duplicate=${index + 1}`, payload);
  if (!ok) { process.exitCode = 1; break; }
  if (index + 1 < repeat && intervalMs) await new Promise(resolve => setTimeout(resolve, intervalMs));
}

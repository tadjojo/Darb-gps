#!/usr/bin/env node
// DARB GPS API simulator. Node.js 20+.
import fs from 'node:fs/promises';
import process from 'node:process';

const args = Object.fromEntries(process.argv.slice(2).reduce((items, value, index, all) => {
  if (!value.startsWith('--')) return items;
  items.push([value.slice(2), all[index + 1]?.startsWith('--') || all[index + 1] === undefined ? 'true' : all[index + 1]]);
  return items;
}, []));
for (const key of ['url', 'credential', 'protocol']) if (!args[key]) {
  console.error('Required: --url <API base ending /api/v1> --credential <device token> --protocol json|nmea0183|gt06');
  process.exit(2);
}
if (!['json', 'nmea0183', 'gt06'].includes(args.protocol)) throw new Error('protocol must be json, nmea0183 or gt06');
const base = args.url.replace(/\/$/, '');
if (!/^https?:\/\//i.test(base)) throw new Error('--url must be an absolute HTTP(S) API base URL');
const routes = { json: '/device-gateway/ingest', nmea0183: '/device-gateway/ingest/nmea', gt06: '/device-gateway/ingest/gt06' };
const endpoint = base + routes[args.protocol];

function nmeaPayload() {
  const now = new Date();
  const time = [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()].map(x => String(x).padStart(2, '0')).join('');
  const date = [now.getUTCDate(), now.getUTCMonth() + 1, now.getUTCFullYear() % 100].map(x => String(x).padStart(2, '0')).join('');
  const body = `GPRMC,${time}.00,A,3157.0000,N,03556.0000,E,12.0,90.0,${date},,,A`;
  let checksum = 0; for (const c of body) checksum ^= c.charCodeAt(0);
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, '0')}`;
}
async function payload() {
  if (args['payload-file']) {
    const content = (await fs.readFile(args['payload-file'], 'utf8')).trim();
    if (args.protocol === 'json') return JSON.parse(content);
    if (args.protocol === 'nmea0183') return content.split(/\r?\n/)[0];
    return content.replace(/\s+/g, '');
  }
  if (args.protocol === 'json') return { latitude: 31.95, longitude: 35.91, speedKmh: 12, heading: 90, recordedAt: new Date().toISOString() };
  if (args.protocol === 'nmea0183') return nmeaPayload();
  throw new Error('GT06 requires --payload-file with a valid hexadecimal location frame');
}
function requestBody(value) {
  if (args.protocol === 'json') return value;
  if (args.protocol === 'nmea0183') return { sentence: value };
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(value) || value.length < 20 || value.length > 520) throw new Error('GT06 payload must be 20–520 hexadecimal characters');
  return { frameHex: value };
}
const attempts = Math.max(1, Math.min(10, Number(args.retries ?? 3)));
const repeat = Math.max(1, Math.min(100000, Number(args.repeat ?? 1)));
const delay = Math.max(0, Math.min(60000, Number(args['interval-ms'] ?? 5000)));
if (!Number.isInteger(attempts) || !Number.isInteger(repeat) || !Number.isFinite(delay)) throw new Error('Invalid retry/repeat/interval setting');
async function send(label, body) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: {
        authorization: `Bearer ${args.credential}`, 'content-type': 'application/json',
      }, body: JSON.stringify(body) });
      const responseText = await response.text();
      console.log(`${label} attempt=${attempt} status=${response.status} response=${responseText.slice(0, 300)}`);
      if (response.ok) return true;
      if (response.status >= 400 && response.status < 500) return false;
    } catch (error) { console.log(`${label} attempt=${attempt} network_error=${error.message}`); }
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, Math.min(30000, 500 * attempt)));
  }
  return false;
}
for (let index = 0; index < repeat; index++) {
  const body = requestBody(await payload());
  if (!await send(`event=${index + 1}/${repeat}`, body)) { process.exitCode = 1; break; }
  if (args.duplicate === 'true' && !await send(`duplicate=${index + 1}`, body)) { process.exitCode = 1; break; }
  if (index + 1 < repeat && delay) await new Promise(resolve => setTimeout(resolve, delay));
}

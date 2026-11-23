#!/usr/bin/env node
// Local contract test: verifies that the simulator sends each protocol to the real API route shape.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const simulator = path.join(path.dirname(fileURLToPath(import.meta.url)), 'simulate-tracker.mjs');
const requests = [];
const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization,
    contentType: req.headers['content-type'], body: JSON.parse(raw) });
  res.writeHead(202, { 'content-type': 'application/json' }).end('{"accepted":true}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v1`;
function run(protocol, extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [simulator, '--url', base, '--credential', 'local-test-token',
      '--protocol', protocol, '--interval-ms', '0', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk);
    child.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk);
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}
try {
  const json = await run('json');
  const nmea = await run('nmea0183');
  const gt06 = await run('gt06', ['--payload-file', path.join(path.dirname(simulator), 'test-fixtures', 'gt06-location-frame.hex')]);
  for (const [name, result] of [['json', json], ['nmea', nmea], ['gt06', gt06]]) {
    if (result.code !== 0) throw new Error(`${name} simulator failed: ${result.stdout} ${result.stderr}`);
  }
  const expected = [
    ['/api/v1/device-gateway/ingest', 'json'],
    ['/api/v1/device-gateway/ingest/nmea', 'nmea'],
    ['/api/v1/device-gateway/ingest/gt06', 'gt06'],
  ];
  for (let i = 0; i < expected.length; i++) {
    const request = requests[i];
    if (request.method !== 'POST' || request.url !== expected[i][0] ||
        request.authorization !== 'Bearer local-test-token' || request.contentType !== 'application/json') {
      throw new Error(`Incorrect ${expected[i][1]} request contract: ${JSON.stringify(request)}`);
    }
  }
  const [jsonBody, nmeaBody, gt06Body] = requests.map(x => x.body);
  if (typeof jsonBody.latitude !== 'number' || typeof jsonBody.longitude !== 'number' || !jsonBody.recordedAt) throw new Error('JSON body does not match TrackerLocationDto');
  if (typeof nmeaBody.sentence !== 'string' || !/^\$.*\*[0-9A-Fa-f]{2}$/.test(nmeaBody.sentence)) throw new Error('NMEA body does not match NmeaIngestDto');
  if (typeof gt06Body.frameHex !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(gt06Body.frameHex)) throw new Error('GT06 body does not match Gt06IngestDto');
  console.log('PASS simulator API contracts: JSON, NMEA 0183, GT06');
} finally {
  await new Promise(resolve => server.close(resolve));
}

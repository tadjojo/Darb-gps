#!/usr/bin/env node
// Dependency-free smoke test for the independent GPS simulator.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const simulator = path.join(here, 'simulate-tracker.mjs');
const seen = new Set();
let requests = 0;
let duplicates = 0;

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    const parsed = JSON.parse(body);
    const payload = typeof parsed.payload === 'string' ? JSON.parse(parsed.payload) : parsed.payload;
    if (parsed.protocol !== 'json' || !payload?.latitude || !payload?.longitude) {
      res.writeHead(400).end('invalid test payload');
      return;
    }
    requests += 1;
    const key = JSON.stringify(payload);
    const duplicate = seen.has(key);
    if (duplicate) duplicates += 1;
    else seen.add(key);
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ accepted: true, duplicate }));
  } catch {
    res.writeHead(400).end('invalid JSON');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const child = spawn(process.execPath, [simulator,
  '--url', `http://127.0.0.1:${port}/ingest`,
  '--credential', 'local-smoke-test-only',
  '--protocol', 'json', '--repeat', '3', '--duplicate', 'true', '--interval-ms', '0'],
{ stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', resolve);
});
await new Promise((resolve) => server.close(resolve));

if (exitCode !== 0 || requests !== 6 || duplicates !== 3 || seen.size !== 3) {
  console.error({ exitCode, requests, duplicates, uniqueEvents: seen.size, stdout, stderr });
  process.exit(1);
}
console.log('PASS tracker simulator smoke test');
console.log(`requests=${requests}; uniqueEvents=${seen.size}; duplicateEvents=${duplicates}`);

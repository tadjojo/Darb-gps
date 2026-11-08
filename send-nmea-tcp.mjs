#!/usr/bin/env node
import net from 'node:net';

const [host, portText, token, ...sentenceParts] = process.argv.slice(2);
const port = Number(portText);
const sentence = sentenceParts.join(' ').trim();
if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !token || !sentence.startsWith('$')) {
  console.error('Usage: node scripts/send-nmea-tcp.mjs <host> <port> <device-token> <NMEA-RMC-sentence>');
  process.exit(2);
}
const socket = net.createConnection({ host, port });
let authenticated = false;
let buffer = '';
const timeout = setTimeout(() => { console.error('TCP test timed out'); socket.destroy(); process.exitCode = 1; }, 10_000);
socket.setEncoding('utf8');
socket.on('connect', () => socket.write(`AUTH ${token}\r\n`));
socket.on('data', chunk => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const index = buffer.indexOf('\n');
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    console.log(line);
    if (!authenticated && line === 'OK AUTHENTICATED') {
      authenticated = true;
      socket.write(`${sentence}\r\n`);
    } else if (authenticated) {
      clearTimeout(timeout);
      socket.end();
    } else if (line.startsWith('ERR')) {
      clearTimeout(timeout); socket.destroy(); process.exitCode = 1;
    }
  }
});
socket.on('error', error => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
socket.on('close', () => clearTimeout(timeout));

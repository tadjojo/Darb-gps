'use strict';

const net = require('node:net');

function requiredPorts(env = process.env) {
  const gt06Port = Number(env.GT06_PORT || 5023);
  if (!Number.isInteger(gt06Port) || gt06Port < 1 || gt06Port > 65535) {
    throw new Error('GT06_PORT must be a valid TCP port');
  }

  let nmeaDevices;
  try {
    nmeaDevices = JSON.parse(env.NMEA_DEVICE_MAP_JSON || '{}');
  } catch {
    throw new Error('NMEA_DEVICE_MAP_JSON must be valid JSON');
  }
  if (!nmeaDevices || typeof nmeaDevices !== 'object' || Array.isArray(nmeaDevices)) {
    throw new Error('NMEA_DEVICE_MAP_JSON must be a JSON object');
  }

  const ports = [gt06Port];
  if (Object.keys(nmeaDevices).length > 0) {
    const nmeaPort = Number(env.NMEA_PORT || 5024);
    if (!Number.isInteger(nmeaPort) || nmeaPort < 1 || nmeaPort > 65535 || nmeaPort === gt06Port) {
      throw new Error('NMEA_PORT must be a valid TCP port distinct from GT06_PORT');
    }
    ports.push(nmeaPort);
  }
  return ports;
}

function checkPort(port, host = '127.0.0.1', timeoutMs = 1500) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = healthy => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(healthy);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function runHealthcheck(env = process.env, probe = checkPort) {
  const ports = requiredPorts(env);
  const results = await Promise.all(ports.map(port => probe(port)));
  return results.every(Boolean);
}

if (require.main === module) {
  runHealthcheck().then(healthy => {
    if (!healthy) {
      process.stderr.write('[gateway-healthcheck] one or more required TCP listeners are unavailable\\n');
      process.exitCode = 1;
    }
  }).catch(error => {
    process.stderr.write('[gateway-healthcheck] configuration error: ' + error.message + '\\n');
    process.exitCode = 1;
  });
}

module.exports = { requiredPorts, checkPort, runHealthcheck };

'use strict';

const net = require('node:net');
const {
  Gt06StreamDecoder,
} = require('../../api/dist/device-gateway/protocols/gt06-stream-decoder');
const {
  parseGt06Frame,
  parseGt06Login,
} = require('../../api/dist/device-gateway/protocols/gt06.parser');
const {
  handleGt06SessionFrame,
} = require('../../api/dist/device-gateway/protocols/gt06-session');
const { NmeaStreamDecoder } = require('../../api/dist/device-gateway/protocols/nmea-stream-decoder');
const { parseNmeaSentence } = require('../../api/dist/device-gateway/protocols/nmea.parser');

function ipv4ToNumber(value) {
  const normalized = value.startsWith('::ffff:') ? value.slice(7) : value;
  if (net.isIP(normalized) !== 4) return null;
  return normalized.split('.').reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
}

function parseCidr(value) {
  const [address, prefixText] = value.trim().split('/');
  const ip = ipv4ToNumber(address);
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  if (ip === null || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) {
    throw new Error('TRUSTED_DEVICE_CIDRS must contain valid IPv4 CIDR ranges');
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: (ip & mask) >>> 0, mask, prefix };
}

function isCidrContained(source, trusted) {
  return source.prefix >= trusted.prefix &&
    ((source.network & trusted.mask) >>> 0) === trusted.network;
}

function isTrustedAddress(address, ranges) {
  const ip = ipv4ToNumber(address || '');
  return ip !== null && ranges.some(range => ((ip & range.mask) >>> 0) === range.network);
}

function loadConfig() {
  const apiBase = new URL(process.env.DARB_API_BASE_URL || 'https://darb-gps-x.onrender.com/api/v1');
  if (apiBase.protocol !== 'https:' && process.env.ALLOW_INSECURE_API !== 'true') {
    throw new Error('DARB_API_BASE_URL must use HTTPS');
  }
  const rawDevices = JSON.parse(process.env.GT06_DEVICE_MAP_JSON || '{}');
  if (!rawDevices || typeof rawDevices !== 'object' || Array.isArray(rawDevices)) {
    throw new Error('GT06_DEVICE_MAP_JSON must be a JSON object keyed by IMEI');
  }
  const devices = new Map();
  for (const [imei, value] of Object.entries(rawDevices)) {
    if (!/^[0-9]{15}$/.test(imei) || !value || typeof value !== 'object' ||
        typeof value.bearerToken !== 'string' || value.bearerToken.length < 32 ||
        !Array.isArray(value.sourceCidrs) || value.sourceCidrs.length === 0) {
      throw new Error('Each GT06 device entry requires a 15-digit IMEI, bearerToken of at least 32 characters, and non-empty sourceCidrs array');
    }
    const sourceRanges = value.sourceCidrs.map(parseCidr);
    devices.set(imei, { imei, bearerToken: value.bearerToken, sourceRanges });
  }
  if (devices.size === 0) throw new Error('Configure at least one enrolled device in GT06_DEVICE_MAP_JSON');
  const trustedText = (process.env.TRUSTED_DEVICE_CIDRS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (trustedText.length === 0) throw new Error('TRUSTED_DEVICE_CIDRS is required; do not expose IMEI-only login to the public internet');
  const trustedRanges = trustedText.map(parseCidr);
  for (const device of devices.values()) {
    if (device.sourceRanges.some(source => !trustedRanges.some(trusted => isCidrContained(source, trusted)))) {
      throw new Error('Each GT06 sourceCidrs range must be fully contained within TRUSTED_DEVICE_CIDRS');
    }
  }
  const rawNmeaDevices = JSON.parse(process.env.NMEA_DEVICE_MAP_JSON || '{}');
  if (!rawNmeaDevices || typeof rawNmeaDevices !== 'object' || Array.isArray(rawNmeaDevices)) {
    throw new Error('NMEA_DEVICE_MAP_JSON must be a JSON object keyed by static source IPv4 address');
  }
  const nmeaDevices = new Map();
  for (const [sourceIp, value] of Object.entries(rawNmeaDevices)) {
    if (ipv4ToNumber(sourceIp) === null || !value || typeof value !== 'object' ||
        typeof value.bearerToken !== 'string' || value.bearerToken.length < 32) {
      throw new Error('Each NMEA device entry requires a static IPv4 source address and bearerToken of at least 32 characters');
    }
    if (!trustedRanges.some(range => isTrustedAddress(sourceIp, [range]))) {
      throw new Error('Each NMEA source IP must be inside TRUSTED_DEVICE_CIDRS');
    }
    nmeaDevices.set(sourceIp, { sourceIp, bearerToken: value.bearerToken });
  }
  const bearerTokens = new Set();
  for (const device of [...devices.values(), ...nmeaDevices.values()]) {
    if (bearerTokens.has(device.bearerToken)) {
      throw new Error('Each enrolled GPS device must use a unique bearer token');
    }
    bearerTokens.add(device.bearerToken);
  }
  const port = Number(process.env.GT06_PORT || 5023);
  const nmeaPort = Number(process.env.NMEA_PORT || 5024);
  const maxConnections = Number(process.env.MAX_CONNECTIONS || 500);
  const loginTimeoutMs = Number(process.env.LOGIN_TIMEOUT_MS || 15000);
  const idleTimeoutMs = Number(process.env.IDLE_TIMEOUT_MS || 120000);
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !Number.isInteger(nmeaPort) || nmeaPort < 1 || nmeaPort > 65535 || nmeaPort === port ||
      !Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 5000 ||
      !Number.isInteger(loginTimeoutMs) || loginTimeoutMs < 1000 || loginTimeoutMs > 120000 ||
      !Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 10000 || idleTimeoutMs > 3600000) {
    throw new Error('Invalid GT06_PORT, MAX_CONNECTIONS, LOGIN_TIMEOUT_MS, or IDLE_TIMEOUT_MS setting');
  }
  return {
    apiBase: apiBase.toString().replace(/\/$/, ''),
    devices,
    trustedRanges,
    port,
    nmeaPort,
    nmeaDevices,
    maxConnections,
    loginTimeoutMs,
    idleTimeoutMs,
  };
}

function createGateway(config, fetchImpl = fetch) {
  let connections = 0;

  async function postToApi(path, device, body) {
    const response = await fetchImpl(config.apiBase + path, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + device.bearerToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error('DARB API rejected device packet (' + response.status + '): ' + detail);
    }
  }

  const server = net.createServer(socket => {
    if (connections >= config.maxConnections || !isTrustedAddress(socket.remoteAddress, config.trustedRanges)) {
      socket.destroy();
      return;
    }
    connections++;
    socket.setTimeout(config.idleTimeoutMs);
    const decoder = new Gt06StreamDecoder(4096);
    let device = null;
    let pendingFrames = 0;
    let queue = Promise.resolve();
    let loginTimer;

    const close = () => {
      clearTimeout(loginTimer);
      if (!socket.destroyed) socket.destroy();
    };
    loginTimer = setTimeout(close, config.loginTimeoutMs || 15000);
    loginTimer.unref?.();
    socket.once('close', () => {
      clearTimeout(loginTimer);
      connections = Math.max(0, connections - 1);
    });
    socket.on('timeout', close);
    socket.on('error', () => close());

    socket.on('data', chunk => {
      let frames;
      try {
        frames = decoder.push(chunk);
      } catch {
        close();
        return;
      }
      if (!frames.length) return;
      pendingFrames += frames.length;
      if (pendingFrames > 100) {
        close();
        return;
      }
      socket.pause();
      queue = queue.then(async () => {
        for (const raw of frames) {
          if (socket.destroyed) break;
          let frame;
          try {
            frame = parseGt06Frame(raw);
            let result;
            if (frame.protocol === 0x01) {
              const login = parseGt06Login(frame);
              const registered = config.devices.get(login.imei);
              if (!registered) throw new Error('Unregistered GT06 IMEI');
              if (!isTrustedAddress(socket.remoteAddress, registered.sourceRanges)) {
                throw new Error('GT06 source address is not assigned to this device');
              }
              device = registered;
              clearTimeout(loginTimer);
              loginTimer = null;
              result = handleGt06SessionFrame(frame, device.imei, false);
            } else {
              if (!device) throw new Error('GT06 data received before login');
              result = handleGt06SessionFrame(frame, device.imei, true);
            }
            if (result.close) throw new Error('GT06 session rejected');
            if (frame.protocol === 0x13) {
              await postToApi('/device-gateway/heartbeat/gt06', device, {});
            } else if (frame.protocol === 0x12) {
              await postToApi('/device-gateway/ingest/gt06', device, { frameHex: raw.toString('hex') });
            }
            if (result.ack && !socket.destroyed) socket.write(result.ack);
          } catch (error) {
            // Never log bearer tokens or packet bodies.
            process.stderr.write('[gt06-gateway] session closed: ' + (error instanceof Error ? error.message : 'packet error') + '\n');
            close();
            break;
          }
        }
      }).finally(() => {
        pendingFrames = Math.max(0, pendingFrames - frames.length);
        if (!socket.destroyed) socket.resume();
      });
    });
  });
  const activeSockets = new Set();
  server.on('connection', socket => {
    activeSockets.add(socket);
    socket.once('close', () => activeSockets.delete(socket));
  });
  server.closeClients = () => {
    for (const socket of activeSockets) socket.destroy();
  };

  return server;
}


function createNmeaGateway(config, fetchImpl = fetch) {
  let connections = 0;

  async function postToApi(device, line, pairedUtcTimestamp) {
    const body = { sentence: line };
    if (pairedUtcTimestamp) body.pairedUtcTimestamp = pairedUtcTimestamp;
    const response = await fetchImpl(config.apiBase + '/device-gateway/ingest/nmea', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + device.bearerToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error('DARB API rejected NMEA sentence (' + response.status + '): ' + detail);
    }
  }

  const server = net.createServer(socket => {
    const sourceIp = (socket.remoteAddress || '').startsWith('::ffff:')
      ? socket.remoteAddress.slice(7) : socket.remoteAddress;
    const device = config.nmeaDevices.get(sourceIp);
    if (connections >= config.maxConnections || !device ||
        !isTrustedAddress(socket.remoteAddress, config.trustedRanges)) {
      socket.destroy();
      return;
    }
    connections++;
    socket.setTimeout(config.idleTimeoutMs);
    const decoder = new NmeaStreamDecoder(256);
    let lastRmcTimestamp = null;
    let pendingLines = 0;
    let queue = Promise.resolve();
    const close = () => { if (!socket.destroyed) socket.destroy(); };
    socket.once('close', () => { connections = Math.max(0, connections - 1); });
    socket.on('timeout', close);
    socket.on('error', close);

    socket.on('data', chunk => {
      let lines;
      try { lines = decoder.push(chunk); } catch { close(); return; }
      if (!lines.length) return;
      pendingLines += lines.length;
      if (pendingLines > 100) { close(); return; }
      socket.pause();
      queue = queue.then(async () => {
        for (const line of lines) {
          if (socket.destroyed) break;
          try {
            const type = line.split('*')[0].split(',')[0].slice(-3).toUpperCase();
            if (type !== 'RMC' && type !== 'GGA') continue;
            const fix = parseNmeaSentence(line);
            if (fix.sentence === 'RMC') {
              lastRmcTimestamp = fix.recordedAt;
              await postToApi(device, line);
            } else if (lastRmcTimestamp) {
              const rmcClock = new Date(lastRmcTimestamp).toISOString().slice(11, 19).replace(/:/g, '');
              const ggaClock = line.split('*')[0].split(',')[1].slice(0, 6);
              if (rmcClock === ggaClock) await postToApi(device, line, lastRmcTimestamp);
            }
          } catch (error) {
            process.stderr.write('[nmea-gateway] session closed: ' + (error instanceof Error ? error.message : 'sentence error') + '\n');
            close();
            break;
          }
        }
      }).finally(() => {
        pendingLines = Math.max(0, pendingLines - lines.length);
        if (!socket.destroyed) socket.resume();
      });
    });
  });
  const activeSockets = new Set();
  server.on('connection', socket => {
    activeSockets.add(socket);
    socket.once('close', () => activeSockets.delete(socket));
  });
  server.closeClients = () => {
    for (const socket of activeSockets) socket.destroy();
  };
  return server;
}

function shutdownServers(servers, graceMs = 5000) {
  return new Promise(resolve => {
    let remaining = servers.length;
    if (remaining === 0) return resolve();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceClose);
      resolve();
    };
    const forceClose = setTimeout(() => {
      for (const server of servers) server.closeClients?.();
    }, graceMs);
    for (const server of servers) {
      server.close(() => {
        remaining -= 1;
        if (remaining === 0) finish();
      });
    }
  });
}

if (require.main === module) {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write('[gt06-gateway] configuration error: ' + error.message + '\n');
    process.exit(1);
  }
  const server = createGateway(config);
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write('[gt06-gateway] listening on TCP port ' + config.port + '; enrolled devices: ' + config.devices.size + '\n');
  });
  const servers = [server];
  if (config.nmeaDevices.size > 0) {
    const nmeaServer = createNmeaGateway(config);
    servers.push(nmeaServer);
    nmeaServer.listen(config.nmeaPort, '0.0.0.0', () => {
      process.stdout.write('[nmea-gateway] listening on TCP port ' + config.nmeaPort + '; mapped source IPs: ' + config.nmeaDevices.size + '\n');
    });
  }
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownServers(servers).then(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = { createGateway, createNmeaGateway, shutdownServers, isTrustedAddress, isCidrContained, parseCidr, loadConfig };

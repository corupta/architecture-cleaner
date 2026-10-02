// Offline emulation for G2 (the container can't drop its network namespace).
// Preloaded via NODE_OPTIONS=--require; refuses every non-loopback TCP connect and DNS lookup
// made from Node, and logs the attempt to $AC_NET_LOG. Non-Node children (git, curl, engines) are
// covered only by the dead-proxy env in env.sh.
const net = require('node:net');
const dns = require('node:dns');
const fs = require('node:fs');

const logFile = process.env.AC_NET_LOG;
const isLoopback = (host) =>
  !host || host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '::' ||
  host === '0.0.0.0' || /^127\./.test(host) || /^::ffff:127\./.test(host);

function record(kind, host, port) {
  if (!logFile) return;
  const entry = { ts: new Date().toISOString(), pid: process.pid, kind, host, port, argv: process.argv.slice(1, 4) };
  try {
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch {
    // logging must never change test behaviour
  }
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  let host;
  let port;
  if (options && typeof options === 'object') {
    if (options.path) return originalConnect.apply(this, args);
    host = options.host;
    port = options.port;
  } else if (typeof options === 'number' || /^\d+$/.test(String(options))) {
    port = options;
    host = typeof args[1] === 'string' ? args[1] : undefined;
  } else {
    return originalConnect.apply(this, args);
  }
  if (isLoopback(host)) return originalConnect.apply(this, args);
  record('connect', host, port);
  const error = Object.assign(new Error(`ac-offline: blocked connection to ${host}:${port}`), { code: 'ECONNREFUSED', errno: -111, syscall: 'connect' });
  process.nextTick(() => this.destroy(error));
  return this;
};

const originalLookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (isLoopback(hostname)) return originalLookup.call(this, hostname, options, callback);
  record('dns', hostname);
  const error = Object.assign(new Error(`ac-offline: blocked DNS lookup of ${hostname}`), { code: 'ENOTFOUND', errno: -3008, syscall: 'getaddrinfo', hostname });
  process.nextTick(() => callback(error));
};
const originalPromiseLookup = dns.promises.lookup;
dns.promises.lookup = async function (hostname, options) {
  if (isLoopback(hostname)) return originalPromiseLookup.call(this, hostname, options);
  record('dns', hostname);
  throw Object.assign(new Error(`ac-offline: blocked DNS lookup of ${hostname}`), { code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname });
};

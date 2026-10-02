// Offline emulation for target oracles (the container can't drop its network namespace).
// Preloaded via NODE_OPTIONS=--require <dist/oracles/block-net.cjs>; refuses every non-loopback TCP connect and
// DNS name lookup made from Node (IP literals resolve locally) and logs each attempt to $AC_NET_LOG.
// Non-Node children (git, curl, native engines) are covered only by the dead proxy in scripts/target-env.sh.
import dns = require('node:dns');
import fs = require('node:fs');
import net = require('node:net');

const logFile = process.env.AC_NET_LOG;
const isLoopback = (host: string | undefined) =>
  !host || host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '::'
  || host === '0.0.0.0' || /^127\./.test(host) || /^::ffff:127\./.test(host);
const isLocalLookup = (hostname: string) => isLoopback(hostname) || net.isIP(hostname) !== 0;

function record(kind: string, host: string | undefined, port?: unknown) {
  if (!logFile) return;
  const entry = { ts: new Date().toISOString(), pid: process.pid, kind, host, port, argv: process.argv.slice(1, 4) };
  try {
    fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  } catch {
    // logging must never change test behaviour
  }
}

type ConnectArguments = Parameters<net.Socket['connect']>;
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(this: net.Socket, ...args: unknown[]) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  let host: string | undefined;
  let port: unknown;
  if (options && typeof options === 'object') {
    if ('path' in options && options.path) return originalConnect.apply(this, args as ConnectArguments);
    host = (options as { host?: string }).host;
    port = (options as { port?: unknown }).port;
  } else if (typeof options === 'number' || /^\d+$/.test(String(options))) {
    port = options;
    host = typeof args[1] === 'string' ? args[1] : undefined;
  } else {
    return originalConnect.apply(this, args as ConnectArguments);
  }
  if (isLoopback(host)) {
    // Port 9 is target-env.sh's dead proxy: a connect there is a proxied network attempt, so log it too.
    if (Number(port) === 9) record('proxy', host, port);
    return originalConnect.apply(this, args as ConnectArguments);
  }
  record('connect', host, port);
  const error = Object.assign(new Error(`ac-offline: blocked connection to ${host}:${String(port)}`), { code: 'ECONNREFUSED', errno: -111, syscall: 'connect' });
  process.nextTick(() => this.destroy(error));
  return this;
} as typeof net.Socket.prototype.connect;

const originalLookup = dns.lookup;
(dns as { lookup: unknown }).lookup = function lookup(hostname: string, options: unknown, callback?: (...results: unknown[]) => void) {
  if (typeof options === 'function') {
    callback = options as typeof callback;
    options = {};
  }
  if (isLocalLookup(hostname)) return (originalLookup as (...lookupArgs: unknown[]) => void).call(dns, hostname, options, callback);
  record('dns', hostname);
  const error = Object.assign(new Error(`ac-offline: blocked DNS lookup of ${hostname}`), { code: 'ENOTFOUND', errno: -3008, syscall: 'getaddrinfo', hostname });
  process.nextTick(() => callback?.(error));
};
const originalPromiseLookup = dns.promises.lookup;
(dns.promises as { lookup: unknown }).lookup = async function lookup(hostname: string, options?: unknown) {
  if (isLocalLookup(hostname)) return (originalPromiseLookup as (...lookupArgs: unknown[]) => Promise<unknown>).call(dns.promises, hostname, options);
  record('dns', hostname);
  throw Object.assign(new Error(`ac-offline: blocked DNS lookup of ${hostname}`), { code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname });
};

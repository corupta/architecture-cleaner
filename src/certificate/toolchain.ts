// Running a target's own tools: its Node version, shared package-manager caches, CI mode, hooks off, and the
// offline mode G2 measured (a Node preload refusing non-loopback TCP/DNS plus a dead proxy). The TypeScript port
// of scripts/target-env.sh, for checks that spawn the target's runner or oracles.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** This package's root (works from src/ under vitest and from dist/). */
export function packageDirectory(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('package.json of architecture-cleaner not found');
    directory = parent;
  }
  return directory;
}

const targetsDirectory = () => path.join(os.homedir(), 'ac-targets');

/** Absolute path of the `node` binary for a version installed under ~/ac-targets/.node, or the system node. */
export function nodeBinary(version: string): string {
  if (version === 'system') {
    const which = spawnSync('which', ['node'], { encoding: 'utf8' });
    return which.status === 0 ? which.stdout.trim() : process.execPath;
  }
  const binary = path.join(targetsDirectory(), '.node', `node-v${version}-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}`, 'bin', 'node');
  if (!fs.existsSync(binary)) throw new Error(`Node ${version} is not installed at ${binary}`);
  return binary;
}

/** The compiled offline preload (npm run build). */
export function blockNetPreload(): string {
  const preload = path.join(packageDirectory(), 'dist', 'oracles', 'block-net.cjs');
  if (!fs.existsSync(preload)) throw new Error(`${preload} is missing: run npm run build`);
  return preload;
}

export interface TargetEnvironmentOptions {
  node: string;
  /** Network log path: when set, the network is blocked and attempts are logged there. */
  offlineLog?: string;
  extra?: Record<string, string>;
}

export function targetEnvironment({ node, offlineLog, extra }: TargetEnvironmentOptions): NodeJS.ProcessEnv {
  const targets = targetsDirectory();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${path.dirname(nodeBinary(node))}:${process.env.PATH ?? ''}`,
    COREPACK_HOME: path.join(targets, '.corepack'),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    COREPACK_ENABLE_STRICT: '0',
    npm_config_store_dir: path.join(targets, '.pnpm-store'),
    pnpm_config_store_dir: path.join(targets, '.pnpm-store'),
    npm_config_cache: path.join(targets, '.npm-cache'),
    YARN_CACHE_FOLDER: path.join(targets, '.yarn-cache'),
    YARN_GLOBAL_FOLDER: path.join(targets, '.yarn-global'),
    HUSKY: '0',
    CI: 'true',
  };
  // Our own runner's settings must not leak into the target's runner.
  for (const key of Object.keys(env)) if (key.startsWith('VITEST') || key === 'NODE_ENV' || key === 'TEST') delete env[key];
  if (offlineLog) {
    const dead = 'http://127.0.0.1:9';
    Object.assign(env, {
      AC_NET_LOG: offlineLog,
      NODE_OPTIONS: `--require ${blockNetPreload()} ${process.env.NODE_OPTIONS ?? ''}`.trim(),
      HTTP_PROXY: dead, HTTPS_PROXY: dead, ALL_PROXY: dead, http_proxy: dead, https_proxy: dead, all_proxy: dead,
      NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1',
    });
  }
  return { ...env, ...extra };
}

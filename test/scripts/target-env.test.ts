// scripts/target-env.sh puts the target's project-local Node on PATH: the Linux build for the machine's architecture
// (uname -m), or a clear error. Sourced in bash with a stub `uname` and a HOME holding stub Node builds.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '../../scripts/target-env.sh');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-target-env-'));
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

for (const arch of ['x64', 'arm64']) {
  const bin = path.join(home, 'ac-targets', '.node', `node-v1.2.3-linux-${arch}`, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\n', { mode: 0o755 });
}

/**
 * Sources the script as a user would, on a machine whose `uname -s` and `uname -m` print `system` and `machine`, then
 * runs `then` either way; the exit status is the script's.
 */
function source(version: string, system: string, machine: string, then = 'command -v node') {
  const stubs = fs.mkdtempSync(path.join(home, 'stubs-'));
  fs.writeFileSync(path.join(stubs, 'uname'), `#!/bin/sh\ncase "$1" in -s) echo ${system} ;; -m) echo ${machine} ;; *) exit 2 ;; esac\n`, { mode: 0o755 });
  const result = spawnSync('bash', ['-c', `. '${script}' ${version}; status=$?; ${then}; exit $status`], {
    encoding: 'utf8', env: { HOME: home, PATH: `${stubs}:/usr/bin:/bin` },
  });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

const nodeOf = (arch: string) => path.join(home, 'ac-targets', '.node', `node-v1.2.3-linux-${arch}`, 'bin', 'node');

describe('scripts/target-env.sh', () => {
  it('picks linux-x64 on x86_64 and linux-arm64 on aarch64 or arm64', () => {
    expect(source('1.2.3', 'Linux', 'x86_64')).toEqual({ status: 0, stdout: nodeOf('x64'), stderr: '' });
    expect(source('1.2.3', 'Linux', 'aarch64')).toEqual({ status: 0, stdout: nodeOf('arm64'), stderr: '' });
    expect(source('1.2.3', 'Linux', 'arm64')).toEqual({ status: 0, stdout: nodeOf('arm64'), stderr: '' });
  });

  it('stops with a clear error on another machine or system, or a Node version not installed, and sets no PATH', () => {
    const notOnPath = 'case ":$PATH:" in *ac-targets*) echo on-path ;; *) echo clean ;; esac';
    expect(source('1.2.3', 'Linux', 'riscv64', notOnPath)).toEqual({
      status: 1, stdout: 'clean', stderr: "target-env.sh: no Node build for Linux riscv64: the targets' Node is linux-x64 (x86_64) or linux-arm64 (aarch64, arm64)",
    });
    expect(source('1.2.3', 'Darwin', 'arm64').stderr).toBe("target-env.sh: no Node build for Darwin arm64: the targets' Node is linux-x64 (x86_64) or linux-arm64 (aarch64, arm64)");
    expect(source('9.9.9', 'Linux', 'x86_64', notOnPath)).toEqual({ status: 1, stdout: 'clean', stderr: `target-env.sh: Node 9.9.9 is not installed: no ${nodeOf('x64').replace('1.2.3', '9.9.9')}` });
  });

  it('needs no architecture for the system Node', () => {
    expect(source('system', 'Linux', 'riscv64', 'echo "$HUSKY $CI"')).toEqual({ status: 0, stdout: '0 true', stderr: '' });
  });
});

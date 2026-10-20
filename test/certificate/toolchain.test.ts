import { afterEach, describe, expect, it } from 'vitest';
import { nodeBinary } from '../../src/certificate/toolchain.js';

const actual = { platform: process.platform, arch: process.arch };
const pretend = (platform: string, arch: string) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
};

describe('nodeBinary', () => {
  afterEach(() => pretend(actual.platform, actual.arch));

  it('looks a pinned version up in the build for this platform and arch', () => {
    pretend('linux', 'x64');
    expect(() => nodeBinary('0.0.1')).toThrow(/node-v0\.0\.1-linux-x64\/bin\/node/);
    pretend('linux', 'arm64');
    expect(() => nodeBinary('0.0.1')).toThrow(/node-v0\.0\.1-linux-arm64\/bin\/node/);
  });

  it('refuses a platform or arch with no Node build instead of guessing x64', () => {
    pretend('linux', 'riscv64');
    expect(() => nodeBinary('24.21.0')).toThrow('no Node build for linux riscv64');
    pretend('darwin', 'arm64');
    expect(() => nodeBinary('24.21.0')).toThrow('no Node build for darwin arm64');
  });
});

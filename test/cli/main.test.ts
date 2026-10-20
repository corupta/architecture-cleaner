import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// main.ts runs on import, so its shared flag parser is tested through the built CLI (npm run build).
const cli = path.resolve('dist/cli/main.js');
const ac = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

describe.skipIf(!fs.existsSync(cli))('ac (the shared flag parser)', () => {
  it('prints the usage for --help and -h, exit 0', () => {
    for (const flag of ['--help', '-h']) {
      const run = ac('plan', flag);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain('ac plan <repo>');
      expect(run.stderr).toBe('');
    }
  });

  it('names an unknown flag in one line, then the usage, exit 2: no stack trace', () => {
    const run = ac('plan', 'repo', '--bogus');
    expect(run.status).toBe(2);
    expect(run.stderr.split('\n')[0]).toMatch(/^Unknown option '--bogus'/);
    expect(run.stderr).toContain('ac plan <repo>');
    expect(run.stderr).not.toContain('    at ');
  });
});

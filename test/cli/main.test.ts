import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fixtureRepo, profileOf } from '../orchestrator/fixture.js';

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

  it('prints each sub-command\'s own usage for --help and -h, exit 0', () => {
    const usages = { demo: 'ac demo [--replay', report: 'ac report <run-dir>', site: 'ac site --out <dir>', rewrap: 'ac rewrap <repo>', scramble: 'ac scramble <repo>', bench: 'ac bench <manifest.json>' };
    for (const [command, usage] of Object.entries(usages)) {
      for (const flag of ['--help', '-h']) {
        const run = ac(command, flag);
        expect(run.status, `${command} ${flag}`).toBe(0);
        expect(run.stdout).toContain(usage);
        expect(run.stderr).toBe('');
      }
    }
  });

  it('names a sub-command\'s unknown flag in one line, then its usage, exit 2', () => {
    for (const command of ['demo', 'report', 'site', 'rewrap', 'scramble', 'bench']) {
      const run = ac(command, '--bogus');
      expect(run.status, command).toBe(2);
      const [first, ...rest] = run.stderr.trimEnd().split('\n');
      expect(first).toMatch(new RegExp(`^ac ${command}: Unknown option '--bogus'`));
      expect(rest.join('\n')).toContain(`ac ${command} `);
      expect(run.stderr).not.toContain('    at ');
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

describe.skipIf(!fs.existsSync(cli))('ac plan --planner', () => {
  const fixture = fixtureRepo();
  afterAll(() => fs.rmSync(fixture.scratch, { recursive: true, force: true }));

  it('refuses a configuration it doesn\'t know before anything runs, exit 2', () => {
    const run = ac('plan', fixture.repo, '--planner', 'nano', '--cassette', path.join(fixture.scratch, 'absent.jsonl'));
    expect(run.status).toBe(2);
    expect(run.stderr).toBe('--planner is ultra, super-vl, super-vl-low\n');
  });

  it('asks the configuration\'s model: a replay of an empty cassette misses on a Super VL record, spending nothing', () => {
    const cassette = path.join(fixture.scratch, 'absent.jsonl');
    const run = ac('plan', fixture.repo, '--root', 'server', '--planner', 'super-vl', '--cassette', cassette, '--out', path.join(fixture.scratch, 'plan'));
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/^ac plan: replay miss: no super-vl record [0-9a-f]{64}:0 in /);
    expect(fs.existsSync(cassette)).toBe(false);
  });

  it('is refused by every other command of the shared parser in one line, then the usage, exit 2, as an unknown flag is', () => {
    const absent = (name: string) => path.join(fixture.scratch, name);
    const commands = [
      ['analyze', fixture.repo],
      ['run', fixture.repo, '--profile', absent('profile.json'), '--cassette', absent('absent.jsonl'), '--out', absent('run')],
      ['steps', absent('plan.yaml')],
    ];
    for (const command of commands) {
      const run = ac(...command, '--planner', 'super-vl');
      expect(run.status, command[0]).toBe(2);
      const [first, ...rest] = run.stderr.split('\n');
      expect(first).toBe("Option '--planner' is for ac plan and ac bench only");
      expect(rest.join('\n')).toContain('ac plan <repo>');
      expect(run.stdout).toBe('');
    }
  });
});

describe.skipIf(!fs.existsSync(cli))('ac run refuses before it plans', () => {
  const fixture = fixtureRepo();
  afterAll(() => fs.rmSync(fixture.scratch, { recursive: true, force: true }));

  it('a run directory that isn\'t hermetic, given or the default ./ac-runs in the tool clone: exit 2, the planner never runs', () => {
    const profile = path.join(fixture.scratch, 'profile.json');
    fs.writeFileSync(profile, JSON.stringify(profileOf()));
    // Planning would replay this cassette, which doesn't exist: had the planner run, the refusal would be "no plan".
    const cassette = path.join(fixture.scratch, 'absent.jsonl');
    const tool = path.join(fixture.scratch, 'tool');
    fs.mkdirSync(path.join(tool, 'node_modules'), { recursive: true });
    const given = ac('run', fixture.repo, '--profile', profile, '--cassette', cassette, '--out', path.join(tool, 'run'));
    expect(given.status).toBe(2);
    expect(given.stderr).toMatch(new RegExp(`^ac run: the run directory ${path.join(tool, 'run')} is not hermetic: ${path.join(tool, 'node_modules')} is on its path`));
    expect(fs.existsSync(path.join(tool, 'run'))).toBe(false);

    const byDefault = ac('run', fixture.repo, '--profile', profile, '--cassette', cassette, '--branch', 'ac/refused-before-planning');
    expect(byDefault.status).toBe(2);
    expect(byDefault.stderr).toContain(`ac run: the run directory ${path.resolve('ac-runs', 'ac-refused-before-planning')} is not hermetic`);
    expect(byDefault.stderr).not.toContain('no plan');
    expect(fs.existsSync(path.resolve('ac-runs', 'ac-refused-before-planning'))).toBe(false);
    expect(fs.existsSync(cassette)).toBe(false);
  });
});

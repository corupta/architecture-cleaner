// `ac normalize`: step files `ac move` reads, and the declined renames.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCommand } from '../../src/filename-normalization/command.js';
import { cjs, repoFrom } from '../executor/repo.js';

describe('normalizeCommand', () => {
  it('writes one step file per folder and prints declines', () => {
    const root = repoFrom({
      'server/tsconfig.json': cjs({}, ['src']),
      'server/src/modules/user/userService.ts': 'export const a = 1;\n',
      'server/src/modules/user/User.guard.ts': 'export const b = 1;\n',
      'server/src/shared/dateUtils.ts': 'export const c = 1;\n',
    });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-normalize-'));
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(line));
    expect(normalizeCommand(root, { root: 'server', out, json: false })).toBe(0);
    log.mockRestore();
    expect(fs.readdirSync(path.join(out, 'steps'))).toEqual(['01-module-user.json', '02-shared-shared.json']);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'steps', '01-module-user.json'), 'utf8'))).toEqual({
      step: 1, rung: 'R3', group: 'module/user', moves: { 'server/src/modules/user/userService.ts': 'server/src/modules/user/user.service.ts' },
    });
    expect(lines[0]).toMatch(/^R3: 2 steps, 2 renames, 1 declined/);
    expect(lines.at(-1)).toBe('  declined case-only server/src/modules/user/User.guard.ts -> user.guard.ts: server/src/modules/user/User.guard.ts -> server/src/modules/user/user.guard.ts differs only in case');
  });
});

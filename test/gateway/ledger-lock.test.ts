// The ledger lock across real processes: waiters that all find a dead owner's lock must still enter the critical
// section one at a time. The children run budget.ts transpiled into a temporary folder, since node can't load the .ts.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const gatewaySource = path.resolve(import.meta.dirname, '../../src/gateway');
let folder: string;

// Each round plants a dead owner's lock when there is none (as a crashed holder leaves it), then takes the lock. Inside,
// an O_EXCL marker shows whether another process is inside at the same time.
const childScript = `
import fs from 'node:fs';
import os from 'node:os';
import { withLedgerLock } from './budget.js';
const [, , ledger, rounds, deadPid] = process.argv;
const lock = ledger + '.lock';
const marker = ledger + '.inside';
let overlaps = 0;
for (let round = 0; round < Number(rounds); round++) {
  try {
    const descriptor = fs.openSync(lock, 'wx');
    fs.writeSync(descriptor, JSON.stringify({ pid: Number(deadPid), host: os.hostname(), startedAt: 'x', token: 'dead-' + process.pid + '-' + round }) + '\\n');
    fs.closeSync(descriptor);
  } catch {}
  await withLedgerLock(ledger, () => {
    try { fs.closeSync(fs.openSync(marker, 'wx')); } catch { overlaps++; return; }
    const until = Date.now() + 1;
    while (Date.now() < until) {}
    fs.rmSync(marker);
  });
}
process.stdout.write(String(overlaps));
`;

const runChild = (ledger: string, rounds: number, deadPid: number) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(folder, 'child.js'), ledger, String(rounds), String(deadPid)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (errors += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Number(output)) : reject(new Error(`child exited ${code}: ${errors}`))));
  });

beforeAll(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-ledger-lock-'));
  fs.writeFileSync(path.join(folder, 'package.json'), '{"type":"module"}\n');
  for (const name of ['budget', 'models', 'types']) {
    const source = fs.readFileSync(path.join(gatewaySource, `${name}.ts`), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, verbatimModuleSyntax: true } });
    fs.writeFileSync(path.join(folder, `${name}.js`), output.outputText);
  }
  fs.writeFileSync(path.join(folder, 'child.js'), childScript);
});

afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

describe('the ledger lock across processes', () => {
  it('lets one waiter at a time take over a dead owner’s lock, so no two processes are ever inside together', async () => {
    const { pid: deadPid } = spawnSync(process.execPath, ['-e', '']);
    expect(deadPid).toBeGreaterThan(0);
    const ledger = path.join(folder, 'race', 'ledger.jsonl');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    const overlaps = await Promise.all(Array.from({ length: 8 }, () => runChild(ledger, 250, deadPid!)));
    expect(overlaps.reduce((sum, count) => sum + count, 0)).toBe(0);
    expect(fs.readdirSync(path.dirname(ledger))).toEqual([]);
  });

  it('takes over the claim of a waiter that died while taking over a dead owner’s lock', async () => {
    const { withLedgerLock } = await import('../../src/gateway/budget.js');
    const { pid: deadPid } = spawnSync(process.execPath, ['-e', '']);
    const ledger = path.join(folder, 'claim', 'ledger.jsonl');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    const lockText = `${JSON.stringify({ pid: deadPid, host: os.hostname(), startedAt: 'x', token: 'dead-owner' })}\n`;
    fs.writeFileSync(`${ledger}.lock`, lockText);
    const digest = createHash('sha256').update(lockText).digest('hex').slice(0, 16);
    fs.writeFileSync(`${ledger}.lock.claim-${digest}`, `${JSON.stringify({ pid: deadPid, host: os.hostname(), startedAt: 'x', token: 'dead-waiter' })}\n`);
    const started = performance.now();
    expect(await withLedgerLock(ledger, () => 'inside')).toBe('inside');
    expect(performance.now() - started).toBeLessThan(3000);
    expect(fs.readdirSync(path.dirname(ledger))).toEqual([]);
  });
});

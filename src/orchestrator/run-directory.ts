// The run directory (contract C7, shapes in types.ts): run.json rewritten atomically at every transition, so a run
// killed at any point resumes from what is on disk; events.jsonl appended; certificates stored as JSON plus summary,
// a stored FAIL never overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { summarize } from '../certificate/report.js';
import type { Certificate } from '../certificate/types.js';
import type { CertificateRecord, RunEvent, RunState } from './types.js';

export interface RunDirectory {
  root: string;
  path(...parts: string[]): string;
  writeJson(file: string, value: unknown): void;
  writeText(file: string, text: string): void;
  saveState(state: RunState): void;
  event(event: Omit<RunEvent, 'ts'>): void;
  /** Stores a certificate as `<file>.json` and `<file>.txt`; `file` is run-dir-relative, without extension. */
  storeCertificate(file: string, certificate: Certificate): CertificateRecord;
  /** `file`, or, when a FAIL is stored there, the first of `<file>-2`, `<file>-3`, ... where none is. */
  certificateFile(file: string): string;
  /** A fresh scratch directory under work/. */
  workDir(name: string): string;
}

const runStateFile = 'run.json';

export function readRunState(root: string): RunState {
  const file = path.join(root, runStateFile);
  if (!fs.existsSync(file)) throw new Error(`no ${runStateFile} in ${root}`);
  const state = JSON.parse(fs.readFileSync(file, 'utf8')) as RunState;
  if (state.format !== 'ac-run/1') throw new Error(`${file}: unknown format ${String(state.format)}`);
  return state;
}

export function openRunDirectory(root: string): RunDirectory {
  const absolute = path.resolve(root);
  fs.mkdirSync(absolute, { recursive: true });
  const resolve = (...parts: string[]) => path.join(absolute, ...parts);
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(resolve(file)), { recursive: true });
    const temporary = `${resolve(file)}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, resolve(file));
  };
  const holdsFail = (file: string) => fs.existsSync(resolve(`${file}.json`)) && (JSON.parse(fs.readFileSync(resolve(`${file}.json`), 'utf8')) as Certificate).verdict === 'fail';
  const certificateFile = (file: string) => {
    let name = file;
    for (let copy = 2; holdsFail(name); copy++) name = `${file}-${copy}`;
    return name;
  };
  return {
    root: absolute,
    path: resolve,
    writeJson: (file, value) => write(file, `${JSON.stringify(value, null, 1)}\n`),
    writeText: write,
    saveState: (state) => write(runStateFile, `${JSON.stringify(state, null, 1)}\n`),
    event(event) {
      fs.appendFileSync(resolve('events.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
    },
    certificateFile,
    storeCertificate(requested, certificate) {
      const file = certificateFile(requested);
      write(`${file}.json`, `${JSON.stringify(certificate, null, 1)}\n`);
      write(`${file}.txt`, `${summarize(certificate)}\n`);
      return {
        file: `${file}.json`,
        verdict: certificate.verdict,
        scope: certificate.scope,
        digest: certificate.digest,
        base: certificate.base,
        head: certificate.head,
        failing: certificate.checks.filter((check) => check.status === 'fail' || check.status === 'error').map((check) => check.id),
      };
    },
    workDir(name) {
      const directory = resolve('work', name);
      fs.rmSync(directory, { recursive: true, force: true });
      fs.mkdirSync(directory, { recursive: true });
      return directory;
    },
  };
}

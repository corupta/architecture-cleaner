// The data the v2 graphics draw, read from the runs' own files and immich's git history, so no figure in a picture can
// drift from its source. Writes video/out/v2/data.js (`window.AC_DATA = {...}`), which the pages under
// video/v2/graphics/ load with a <script> tag (a page opened from file:// can't fetch JSON).
//
//   node v2/graphics/data.mjs [--immich ~/ac-targets/immich]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { immich: { type: 'string', default: path.join(os.homedir(), 'ac-targets', 'immich') } } });
const video = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const repository = path.dirname(video);
const runs = path.join(repository, 'runs');
const git = (...args) => execFileSync('git', ['-C', values.immich, ...args], { encoding: 'utf8' });
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readEvents = (run) => fs.readFileSync(path.join(runs, run, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

const certificate = readJson(path.join(runs, 'immich-ladder', 'certificate.json'));
const base = certificate.base;
const moves = Object.entries(certificate.pathMap.entries);
const strip = (file) => file.replace(/^server\/src\//, '');

// B0: immich's server/src at the base commit, sliced by type: each top-level folder and its files.
const baseFiles = git('ls-tree', '-r', '--name-only', base, 'server/src').trim().split('\n').map(strip);
const typeFolders = {};
for (const file of baseFiles) {
  const [folder, ...rest] = file.split('/');
  if (!rest.length) continue;
  (typeFolders[folder] ??= []).push(rest.join('/'));
}

// B1, B9: a feature's files, before and after (specs left out: the picture is about where the code lives).
const feature = (name) => moves
  .filter(([, to]) => to.startsWith(`server/src/modules/${name}/`) && !to.endsWith('.spec.ts'))
  .map(([from, to]) => ({ from: strip(from), to: strip(to).replace(/^modules\//, '') }));

// B6, B7: the runs' own logs: each commit (62 move steps and R4's rules commit, 63 on the ladder), when each step
// ended and how, the rollbacks and pins, and how long the run took.
const timeline = (run) => {
  const events = readEvents(run);
  const start = Date.parse(events[0].ts);
  const at = (event) => (Date.parse(event.ts) - start) / 1000;
  return {
    seconds: at(events.at(-1)),
    commits: events.filter((event) => event.event === 'commit').map((event) => ({ step: event.step, at: at(event) })),
    steps: events.filter((event) => event.event === 'step-end').map((event) => ({ step: event.step, group: event.group, rung: event.rung, status: event.status, at: at(event) })),
    rollbacks: events.filter((event) => event.event === 'rollback').map((event) => ({ step: event.step, attempt: event.attempt, at: at(event) })),
    pins: events.filter((event) => event.event === 'pin').map((event) => ({ step: event.step, files: event.files.map(strip), at: at(event) })),
    certifies: events.filter((event) => event.event === 'certify').map((event) => ({ step: event.step, attempt: event.attempt, verdict: event.verdict, failing: event.failing, at: at(event) })),
  };
};

// B2: immich's own restructure, March 20–22, 2024: the pull requests that changed server/src (the S9 hook tape's range,
// its one fix left out), oldest first.
const history = git('log', '--format=%ad%x09%s', '--date=format:%b %d', '--invert-grep', '--grep=^fix', 'e6f2bb9f89..6e93ddf2f1', '--', 'server/src')
  .trim().split('\n').map((line) => {
    const [date, subject] = line.split('\t');
    const number = /\(#(\d+)\)$/.exec(subject)?.[1];
    return { date, title: subject.replace(/\s*\(#\d+\)$/, ''), number: Number(number) };
  }).sort((left, right) => left.number - right.number);

const data = {
  base,
  typeFolders,
  features: { album: feature('album'), asset: feature('asset'), user: feature('user') },
  runs: { ladder: timeline('immich-ladder'), fault: timeline('immich-fault') },
  history,
};
const out = path.join(video, 'out', 'v2');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'data.js'), `window.AC_DATA = ${JSON.stringify(data, null, 1)};\n`);
console.log(`out/v2/data.js: ${baseFiles.length} files at ${base.slice(0, 10)}, ${moves.length} moves, ${history.length} PRs, ${data.runs.ladder.steps.length} + ${data.runs.fault.steps.length} steps`);

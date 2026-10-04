// `node <build>/mutation/run.js --targets <list> --out <dir>`: runs the mutation harness and writes
// <out>/mutants.json, <out>/controls.json and <out>/report.md.
//   --targets    comma list of: fixtures, fixture:<name>, synthetic, hunt, openhab-cloud, immich-album, immich-r1, immich, all
//   --operators  comma list of operator ids (default: all)
//   --checks     comma list of check ids (default: K0,K1,K2,K3a,K3b,K3c,K4,K6)
//   --cap        instances per operator variant and subject (default 3)
//   --exhaustive run every check on every mutant (default: stop after the tree-only checks when they kill)
//   --work-dir   scratch directory (default: a fresh /tmp/ac-s4-mutation/run-*)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { CheckId } from '../certificate/types.js';
import { coverageSubject } from './coverage-subject.js';
import { fixtureSubjects, loadHuntCases, runHarness, staticChecks, targetSubject } from './harness.js';
import { renderReport } from './report.js';
import type { SubjectSpec } from './subject.js';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      targets: { type: 'string', default: 'fixtures,synthetic,hunt,openhab-cloud' },
      out: { type: 'string' },
      operators: { type: 'string' },
      checks: { type: 'string' },
      cap: { type: 'string', default: '3' },
      'work-dir': { type: 'string' },
      exhaustive: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
    },
  });
  if (!values.out) {
    console.error('usage: run.js --targets <fixtures,synthetic,hunt,openhab-cloud,immich-album,immich-r1,...> --out <dir> [--operators M1,M2] [--checks K1,K2] [--cap 3] [--exhaustive] [--work-dir <dir>]');
    return 2;
  }
  const requested = values.targets.split(',').map((target) => target.trim()).filter(Boolean);
  const expanded = requested.flatMap((target) => (target === 'all' ? ['fixtures', 'synthetic', 'hunt', 'openhab-cloud', 'immich-album', 'immich-r1'] : target === 'immich' ? ['immich-album', 'immich-r1'] : [target]));
  const subjects: SubjectSpec[] = [];
  const fixtureNames = expanded.filter((target) => target.startsWith('fixture:')).map((target) => target.slice('fixture:'.length));
  if (expanded.includes('fixtures')) subjects.push(...fixtureSubjects());
  else if (fixtureNames.length) subjects.push(...fixtureSubjects(undefined, fixtureNames));
  if (expanded.includes('synthetic')) subjects.push(coverageSubject());
  for (const target of expanded.filter((target) => !['fixtures', 'synthetic', 'hunt'].includes(target) && !target.startsWith('fixture:'))) subjects.push(targetSubject(target));
  const hunt = expanded.includes('hunt') ? loadHuntCases() : [];
  const workDir = values['work-dir'] ?? (fs.mkdirSync('/tmp/ac-s4-mutation', { recursive: true }), fs.mkdtempSync('/tmp/ac-s4-mutation/run-'));
  const log = (message: string) => process.stderr.write(`[mutation] ${message}\n`);
  log(`work dir ${workDir}; ${subjects.length} subjects, ${hunt.length} hunt cases`);
  const result = await runHarness({
    subjects,
    hunt,
    ...(values.operators ? { operators: values.operators.split(',').map((id) => id.trim()) } : {}),
    cap: Number(values.cap),
    checks: values.checks ? (values.checks.split(',').map((id) => id.trim()) as CheckId[]) : staticChecks,
    staged: !values.exhaustive,
    workDir,
    quiet: !values.verbose,
    log,
  });
  fs.mkdirSync(values.out, { recursive: true });
  fs.writeFileSync(path.join(values.out, 'mutants.json'), `${JSON.stringify(result.mutants, null, 2)}\n`);
  const { mutants: _mutants, ...rest } = result;
  fs.writeFileSync(path.join(values.out, 'controls.json'), `${JSON.stringify(rest, null, 2)}\n`);
  fs.writeFileSync(path.join(values.out, 'report.md'), renderReport(result));
  const survivors = result.mutants.filter((mutant) => mutant.effectivelySurvived).length;
  log(`${result.mutants.length} mutants, ${survivors} survived; controls: ${result.controls.map((control) => `${control.subject}=${control.verdict}`).join(' ')}; ${(result.durationMs / 1000).toFixed(0)} s`);
  log(`wrote ${path.join(values.out, 'report.md')}`);
  // A known-good result that fails its control invalidates its row. A hunt case's identity control may fail K0 by
  // design (JS-only repros sit outside the envelope); its kills are discounted against that control instead.
  return survivors || result.controls.some((control) => control.verdict !== 'pass' && !control.subject.startsWith('hunt:')) ? 1 : 0;
}

main().then((code) => process.exit(code), (error) => {
  console.error(error);
  process.exit(2);
});

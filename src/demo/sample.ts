// Certifying the demo's commits again with `ac certify`'s own code (the checker never imports the executor): a sample
// of steps with the static checks, and the whole PR with the oracles. Each certificate is written to the work dir and
// set next to the recorded run's certificate of the same step: check by check, and digest against digest.
import fs from 'node:fs';
import path from 'node:path';
import { certify } from '../certificate/certify.js';
import type { Profile } from '../certificate/profile.js';
import { summarize } from '../certificate/report.js';
import type { Certificate, CheckId } from '../certificate/types.js';
import type { CertifiedEntry, StepEntry } from './report.js';

/** Which committed steps to certify again: the first, the largest, an R3 rename, then spread evenly over the rest. */
export function sampleSteps(steps: StepEntry[], size: number | 'all'): { index: number; reason: string }[] {
  const committed = steps.filter((step) => step.outcome === 'committed' && step.rung !== 'R4');
  if (size === 'all') return committed.map((step) => ({ index: step.index, reason: 'every step' }));
  const picks: { index: number; reason: string }[] = [];
  const add = (step: StepEntry | undefined, reason: string) => {
    if (step && !picks.some((pick) => pick.index === step.index)) picks.push({ index: step.index, reason });
  };
  const largest = [...committed].sort((a, b) => b.moves - a.moves || a.index - b.index)[0];
  add(committed[0], 'the first step');
  add(largest, `the largest step, ${largest?.moves ?? 0} moves`);
  add(committed.find((step) => step.rung === 'R3'), 'an R3 rename');
  const rest = committed.filter((step) => !picks.some((pick) => pick.index === step.index));
  const wanted = Math.min(Math.max(0, size - picks.length), rest.length);
  for (let spread = 0; spread < wanted; spread++) add(rest[Math.floor(((spread + 0.5) * rest.length) / wanted)], 'spread over the ladder');
  return picks.slice(0, Math.max(0, size)).sort((a, b) => a.index - b.index);
}

/** The certificate's checks next to the recorded certificate's statuses. */
export function compareChecks(certificate: Certificate, recorded: Certificate | null): CertifiedEntry['checks'] {
  return certificate.checks.map((check) => ({
    id: check.id, status: check.status, recorded: recorded?.checks.find((candidate) => candidate.id === check.id)?.status ?? null,
    ...(check.skipReason ? { skipReason: check.skipReason } : {}),
  }));
}

export const readCertificate = (file: string): Certificate | null => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as Certificate : null);

export interface CertifyInput {
  checkout: string;
  environment: string;
  profile: Profile;
  workDir: string;
  base: string;
  head: string;
  oracles: boolean;
  only?: CheckId[];
  /** File name under <work>/certificates/, without extension. */
  name: string;
}

/** Certifies base..head and writes <work>/certificates/<name>.{json,txt}; the per-tree cache lives in <work>/cache. */
export async function certifyInto(input: CertifyInput): Promise<{ certificate: Certificate; file: string; durationMs: number }> {
  const started = performance.now();
  const certificate = await certify({
    repo: input.checkout, base: input.base, head: input.head, packageRoot: input.profile.packageRoot.replace(/^\.\/?/, '').replace(/\/$/, ''), environment: input.environment,
    profile: input.profile, oracles: input.oracles, ...(input.only ? { only: input.only } : {}), workDir: path.join(input.workDir, 'certify', input.name),
    cacheDir: path.join(input.workDir, 'cache'), keep: false,
  });
  const file = path.join('certificates', `${input.name}.json`);
  fs.mkdirSync(path.join(input.workDir, 'certificates'), { recursive: true });
  fs.writeFileSync(path.join(input.workDir, file), `${JSON.stringify(certificate, null, 1)}\n`);
  fs.writeFileSync(path.join(input.workDir, file.replace(/\.json$/, '.txt')), `${summarize(certificate)}\n`);
  return { certificate, file, durationMs: Math.round(performance.now() - started) };
}

export interface SampleOptions {
  steps: StepEntry[];
  size: number | 'all';
  checkout: string;
  environment: string;
  profile: Profile;
  workDir: string;
  checks: CheckId[];
  /** The recorded certificate of a step, when there is one. */
  recorded(index: number): Certificate | null;
  log(message: string): void;
}

/** The sample's static certificates, in step order. */
export async function certifySample(options: SampleOptions): Promise<CertifiedEntry[]> {
  const entries: CertifiedEntry[] = [];
  for (const pick of sampleSteps(options.steps, options.size)) {
    const step = options.steps.find((candidate) => candidate.index === pick.index)!;
    options.log(`certifying step ${step.index} (${pick.reason}): ${options.checks.join(' ')}`);
    const { certificate, file, durationMs } = await certifyInto({
      checkout: options.checkout, environment: options.environment, profile: options.profile, workDir: options.workDir, base: step.parent, head: step.commit!,
      oracles: false, only: options.checks, name: `${String(step.index).padStart(3, '0')}-${step.rung}-${step.group.replace('/', '-')}`,
    });
    const recorded = options.recorded(step.index);
    entries.push({
      subject: step.index, rung: step.rung, group: step.group, reason: pick.reason, verdict: certificate.verdict, scope: certificate.scope, checks: compareChecks(certificate, recorded),
      digest: certificate.digest, recordedDigest: recorded?.digest ?? null, file, durationMs,
    });
    options.log(`step ${step.index}: ${certificate.verdict.toUpperCase()} (${Math.round(durationMs / 1000)} s)`);
  }
  return entries;
}

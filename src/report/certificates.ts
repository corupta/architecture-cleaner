// Reading stored certificates for the report: format ac-certificate/2 (trees, the run's certificates) and
// ac-certificate/1 (S4's: the same checks[] shape, no trees), reduced to what the pages show. The readable summary is
// the .txt the run stored next to the JSON (its log lines dropped), else rendered from the JSON.
import fs from 'node:fs';
import { summarize } from '../certificate/report.js';
import type { Certificate, CheckId, CheckStatus } from '../certificate/types.js';

export interface CheckView {
  id: CheckId;
  title: string;
  status: CheckStatus;
  summary: string;
  violations: number;
  findings: number;
  metrics: Record<string, number | string | boolean>;
  durationMs: number;
}

export interface CertificateView {
  format: 'ac-certificate/1' | 'ac-certificate/2';
  verdict: 'pass' | 'fail';
  scope: 'full' | 'static';
  digest: string;
  base: string;
  head: string;
  /** null on format 1. */
  baseTree: string | null;
  headTree: string | null;
  packageRoot: string;
  profile: string | null;
  pathMap: { moves: number; editedInPlace: number; unchanged: number; added: number; deleted: number };
  checks: CheckView[];
  /** Checks that failed or errored. */
  failing: CheckId[];
  residualRisk: string[];
}

/** The fields both formats share; format 1 has no trees or profile. */
type StoredCertificate = Omit<Certificate, 'format' | 'baseTree' | 'headTree' | 'profile' | 'workDir'> & {
  format: 'ac-certificate/1' | 'ac-certificate/2';
  baseTree?: string;
  headTree?: string;
  profile?: string | null;
};

export function certificateView(certificate: StoredCertificate): CertificateView {
  if (certificate.format !== 'ac-certificate/1' && certificate.format !== 'ac-certificate/2') throw new Error(`unknown certificate format ${String(certificate.format)}`);
  const checks = certificate.checks.map((check): CheckView => ({
    id: check.id, title: check.title, status: check.status, summary: check.summary,
    violations: check.violations.length, findings: check.findings.length, metrics: check.metrics, durationMs: check.durationMs,
  }));
  return {
    format: certificate.format,
    verdict: certificate.verdict,
    scope: certificate.scope,
    digest: certificate.digest,
    base: certificate.base,
    head: certificate.head,
    baseTree: certificate.baseTree ?? null,
    headTree: certificate.headTree ?? null,
    packageRoot: certificate.packageRoot,
    profile: certificate.profile ?? null,
    pathMap: {
      moves: certificate.pathMap.moves, editedInPlace: certificate.pathMap.editedInPlace, unchanged: certificate.pathMap.unchanged,
      added: certificate.pathMap.added.length, deleted: certificate.pathMap.deleted.length,
    },
    checks,
    failing: checks.filter((check) => check.status === 'fail' || check.status === 'error').map((check) => check.id),
    residualRisk: certificate.residualRisk,
  };
}

export function readCertificate(jsonFile: string): { certificate: StoredCertificate; view: CertificateView } {
  const certificate = JSON.parse(fs.readFileSync(jsonFile, 'utf8')) as StoredCertificate;
  return { certificate, view: certificateView(certificate) };
}

/** The certifier's progress lines (`[certify] ...`) that a summary captured from a terminal starts with. */
const logLine = /^\[certify\] /;

/** The stored summary next to `jsonFile` without its log lines, else one rendered from the certificate. */
export function certificateSummary(jsonFile: string, certificate: StoredCertificate): string {
  const textFile = jsonFile.replace(/\.json$/, '.txt');
  if (fs.existsSync(textFile)) {
    return fs.readFileSync(textFile, 'utf8').split('\n').filter((line) => !logLine.test(line)).join('\n').trim();
  }
  if (certificate.format === 'ac-certificate/2') return summarize(certificate as unknown as Certificate);
  // Format 1 has no trees: summarize's tree line would name nothing.
  return summarize({ ...certificate, baseTree: '', headTree: '', profile: null } as unknown as Certificate)
    .split('\n').filter((line) => !line.startsWith('trees: ')).join('\n');
}

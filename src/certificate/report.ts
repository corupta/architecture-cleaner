// Readable forms of a certificate: a summary for people and git trailers for the commit message.
import type { Certificate, CheckResult } from './types.js';

const mark: Record<CheckResult['status'], string> = { pass: 'PASS', fail: 'FAIL', skip: 'skip', error: 'ERROR' };

export function summarize(certificate: Certificate, { maxViolations = 8 } = {}): string {
  const lines: string[] = [];
  const short = (sha: string) => sha.slice(0, 10);
  lines.push(`ac certify ${short(certificate.base)}..${short(certificate.head)}${certificate.packageRoot ? ` (package root ${certificate.packageRoot}/)` : ''}${certificate.profile ? `, profile ${certificate.profile}` : ''}`);
  lines.push(`trees: ${short(certificate.baseTree)}..${short(certificate.headTree)}`);
  const map = certificate.pathMap;
  lines.push(`pathMap: ${map.moves} moves, ${map.editedInPlace} edited in place, ${map.unchanged} unchanged, ${map.added.length} added, ${map.deleted.length} deleted`);
  lines.push('');
  for (const check of certificate.checks) {
    lines.push(`${mark[check.status].padEnd(5)} ${check.id.padEnd(3)} ${check.title}: ${check.summary} (${(check.durationMs / 1000).toFixed(1)} s)`);
    for (const violation of check.violations.slice(0, maxViolations)) lines.push(`        ${violation.file ? `${violation.file}: ` : ''}${violation.detail.split('\n')[0]}`);
    if (check.violations.length > maxViolations) lines.push(`        … ${check.violations.length - maxViolations} more`);
    for (const finding of check.findings.slice(0, 3)) lines.push(`        finding (${finding.kind}) ${finding.file ? `${finding.file}: ` : ''}${finding.detail}`);
    if (check.findings.length > 3) lines.push(`        … ${check.findings.length - 3} more findings`);
  }
  lines.push('');
  lines.push(`verdict: ${certificate.verdict.toUpperCase()} (${certificate.scope === 'full' ? 'static checks and oracles' : 'static checks only'})`);
  lines.push(`digest: ${certificate.digest}`);
  return lines.join('\n');
}

/**
 * Git trailers: `git commit --trailer`-ready lines that summarize the certificate. They name trees, not commits, so
 * the trailers (and the certificate) stay true when they are added by amending the certified commit.
 */
export function trailers(certificate: Certificate): string[] {
  const groups = new Map<string, CheckResult['status'][]>();
  for (const check of certificate.checks) {
    const id = check.id.startsWith('K3') ? 'K3' : check.id;
    groups.set(id, [...(groups.get(id) ?? []), check.status]);
  }
  const statusOf = (statuses: CheckResult['status'][]) => (statuses.some((status) => status === 'fail' || status === 'error') ? 'fail' : statuses.every((status) => status === 'skip') ? 'skip' : 'pass');
  const checks = [...groups].map(([id, statuses]) => `${id}=${statusOf(statuses)}`).join(' ');
  return [
    `Ac-Certificate: ${certificate.verdict} (${certificate.scope}) ${checks}`,
    `Ac-Certificate-Base-Tree: ${certificate.baseTree}`,
    `Ac-Certificate-Tree: ${certificate.headTree}`,
    `Ac-Certificate-Digest: ${certificate.digest}`,
  ];
}

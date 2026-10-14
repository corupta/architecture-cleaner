// Findings the run already recorded, de-duplicated: every check finding of the stored certificates (K4's old-path
// strings and docs mentions, K1's ambiguous matches and inert tool configs, K7, K8's flaky and quarantined tests, ...)
// and run.json's own (pins, replans, skipped steps, the bisect, an injected fault, executor findings, R3's declined
// renames). Each step re-reports what it sees, so one finding per (check, kind, file) lists its distinct locations
// and which steps and certificates reported them.
import type { RunFinding } from '../orchestrator/types.js';
import type { StoredCertificate } from './run-data.js';
import type { CollectedFinding } from './types.js';

const kindLabels: Record<string, string> = {
  'old-path-in-docs': 'Docs name old paths',
  'old-path-in-comment': 'Comments name old paths',
  'old-path-in-ignore-file': 'An ignore file names old paths',
  'relative-path-string': 'A relative path string spans moved files',
  'coverage-scope': 'Coverage globs match other files',
  'ungated-coverage-glob': 'Coverage globs match other files, with no gate',
  'opaque-dynamic-load': 'A module loaded by a computed path',
  'stack-text': 'Stack-trace text names moved paths',
  'default-root-dir': 'Emit without a rootDir',
  'ambiguous-match': 'Identical files paired by similarity',
  'tool-config-added': 'Inert tool config added',
  'flaky-test': 'Flaky test',
  'quarantined-test': 'Quarantined test',
  'network-attempt': 'Tests attempt network access',
  'pre-existing-failure': 'An oracle fails on the base too',
  'step-pinned': 'Step pinned',
  'bisect-pinned': 'Step pinned by the K8 bisect',
  pinned: 'Files pinned by a replan',
  'step-skipped': 'Step skipped: every file pinned',
  'executor-error': 'Step pinned: the executor crashed',
  'rename-declined': 'Rename declined (R3)',
  'injected-fault': 'Injected fault (--inject-fault)',
  'fault-not-applied': 'Fault not applied (--inject-fault)',
  'vacuous-boundary-rule': 'A boundary rule never fired',
};

export const kindLabel = (kind: string) => kindLabels[kind] ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1).replace(/-/g, ' ')}`;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const detailLimit = 300;
const locationLimit = 12;

/** Absolute machine paths (logs, work directories) differ per run and per machine: blanked, so evidence (and the
 * narration requests built from it, which a cassette replays by hash) are the same everywhere. */
const withoutMachinePaths = (detail: string) => detail.replace(/(^|[\s(=])\/[^\s),;]+/g, '$1<path>');

/**
 * Where a detail points: its first `line N` and the first quoted string after it (K4 and the executor name a line of
 * a config or doc, then the path string on it), else the whole detail.
 */
export function anchorOf(detail: string): string {
  const line = /\bline (\d+)\b/.exec(detail);
  if (!line) return withoutMachinePaths(detail);
  const quoted = /'([^']*)'/.exec(detail.slice(line.index));
  return quoted ? `line ${line[1]}: '${quoted[1]}'` : `line ${line[1]}`;
}

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/** 1, 2, 3, 5, 7, 8 → "1–3, 5, 7–8". */
export function stepRanges(steps: readonly number[]): string {
  const sorted = [...new Set(steps)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < sorted.length; ) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end]! + 1) end++;
    ranges.push(end === index ? `${sorted[index]}` : `${sorted[index]}–${sorted[end]}`);
    index = end + 1;
  }
  return ranges.join(', ');
}

interface Report {
  detail: string;
  step: number | null;
  certificate: string | null;
}

/** Groups reports by key, then by anchor in first-seen order. */
class ReportGroups<Meta> {
  readonly groups = new Map<string, { meta: Meta; anchors: Map<string, Report[]> }>();

  add(key: string, meta: Meta, report: Report): void {
    let group = this.groups.get(key);
    if (!group) this.groups.set(key, (group = { meta, anchors: new Map() }));
    const anchor = anchorOf(report.detail);
    group.anchors.set(anchor, [...(group.anchors.get(anchor) ?? []), report]);
  }
}

function reportedBy(reports: Report[]): { steps: number[]; certificates: string[]; text: string } {
  const steps = [...new Set(reports.flatMap((report) => (report.step === null ? [] : [report.step])))].sort((a, b) => a - b);
  const certificates = [...new Set(reports.flatMap((report) => (report.step === null && report.certificate ? [report.certificate] : [])))].sort(byCodeUnit);
  const parts = [...(steps.length ? [`${steps.length === 1 ? 'step' : 'steps'} ${stepRanges(steps)}`] : []), ...certificates];
  return { steps, certificates, text: parts.join(', ') };
}

function locationLines(anchors: Map<string, Report[]>): string[] {
  const lines = [...anchors.values()].slice(0, locationLimit).map((reports) => `- ${clip(withoutMachinePaths(reports[0]!.detail), detailLimit)} (${reportedBy(reports).text || 'the run'})`);
  if (anchors.size > locationLimit) lines.push(`- … ${anchors.size - locationLimit} more`);
  return lines;
}

/** Every check finding of every stored certificate, one finding per (check, kind, file). */
export function certificateFindings(certificates: readonly StoredCertificate[]): CollectedFinding[] {
  const groups = new ReportGroups<{ check: string; kind: string; file: string | null }>();
  for (const { file: certificateFile, step, certificate } of certificates) {
    for (const check of certificate.checks) {
      for (const finding of check.findings ?? []) {
        groups.add(`${check.id}\0${finding.kind}\0${finding.file ?? ''}`, { check: check.id, kind: finding.kind, file: finding.file ?? null }, { detail: finding.detail, step, certificate: certificateFile });
      }
    }
  }
  return [...groups.groups].map(([key, { meta, anchors }]) => {
    const reports = [...anchors.values()].flat();
    const by = reportedBy(reports);
    const where = meta.file ? ` in ${meta.file}` : '';
    const count = anchors.size === 1 ? 'one finding' : `${anchors.size} distinct findings`;
    return {
      key,
      kind: meta.kind,
      title: `${kindLabel(meta.kind)} (${meta.check})${meta.file ? `: ${meta.file}` : ''}`,
      files: meta.file ? [meta.file] : [],
      evidence: [`${meta.check} reported ${count}${where}, ${reports.length === 1 ? "once" : `${reports.length} times`} (${by.text}):`, ...locationLines(anchors)].join('\n'),
      source: 'certificate',
      steps: by.steps,
      certificates: by.certificates,
      weight: anchors.size,
    };
  });
}

/** The orchestrator's own kinds: each one an event of its step or rung (src/orchestrator attempt.ts, rungs.ts, run.ts). */
const runEventKinds = new Set(['pinned', 'step-pinned', 'bisect-pinned', 'step-skipped', 'executor-error', 'injected-fault', 'fault-not-applied', 'rename-declined', 'flaky-test', 'vacuous-boundary-rule']);

/** Lines listed under a rung-level event finding (the baseline's flaky files, R3's declined renames). */
const rungEventLimit = 30;

/**
 * run.json's findings. A step's events (a pin, a skip, an injected fault) stay one finding each. A rung's events
 * without a step (the baseline's flaky files in R0, the renames R3 declined) are one finding per (kind, rung) that
 * lists them. Findings the run passed on from the executor (contract C4: `ungated-coverage-glob` on a config line)
 * recur in every step that moves a matching file, so they merge per (kind, files), one location per distinct line.
 */
export function recordedRunFindings(findings: readonly RunFinding[]): CollectedFinding[] {
  const located = new ReportGroups<RunFinding>();
  const stepEvents = new Map<string, { finding: RunFinding; steps: Set<number> }>();
  const rungEvents = new Map<string, RunFinding[]>();
  for (const finding of findings) {
    const files = [...finding.files].sort(byCodeUnit).join('\0');
    if (!runEventKinds.has(finding.kind)) {
      located.add(`${finding.kind}\0${files}`, finding, { detail: finding.detail, step: finding.step ?? null, certificate: null });
    } else if (finding.step === undefined) {
      const key = `${finding.kind}\0${finding.rung ?? ''}`;
      rungEvents.set(key, [...(rungEvents.get(key) ?? []), finding]);
    } else {
      const key = `${finding.kind}\0${finding.step}\0${files}\0${withoutMachinePaths(finding.detail)}`;
      if (!stepEvents.has(key)) stepEvents.set(key, { finding, steps: new Set([finding.step]) });
    }
  }
  const merged: CollectedFinding[] = [...located.groups].map(([key, { meta, anchors }]) => {
    const reports = [...anchors.values()].flat();
    const by = reportedBy(reports);
    const where = meta.files.length ? ` in ${meta.files.join(', ')}` : '';
    return {
      key,
      kind: meta.kind,
      title: `${kindLabel(meta.kind)}${meta.files.length ? `: ${meta.files.join(', ')}` : ''}`,
      files: meta.files,
      evidence: [`The run recorded ${anchors.size === 1 ? 'one finding' : `${anchors.size} distinct findings`}${where}, ${reports.length} times (${by.text}):`, ...locationLines(anchors)].join('\n'),
      source: 'run',
      steps: by.steps,
      weight: anchors.size,
    };
  });
  const ofRung: CollectedFinding[] = [...rungEvents].map(([key, events]) => {
    const rung = events[0]!.rung ?? 'the run';
    const lines = events.map((event) => `- ${event.files.length ? `${event.files.join(', ')}: ` : ''}${clip(withoutMachinePaths(event.detail), detailLimit)}`);
    return {
      key,
      kind: events[0]!.kind,
      title: `${kindLabel(events[0]!.kind)}: ${events.length === 1 ? events[0]!.files[0] ?? rung : `${events.length} in ${rung}`}`,
      files: events.flatMap((event) => event.files),
      evidence: [`${rung} recorded ${events.length === 1 ? 'one' : events.length}:`, ...lines.slice(0, rungEventLimit), ...(lines.length > rungEventLimit ? [`- … ${lines.length - rungEventLimit} more`] : [])].join('\n'),
      source: 'run',
      steps: [],
      weight: events.length,
    };
  });
  const ofStep: CollectedFinding[] = [...stepEvents].map(([key, { finding, steps }]) => {
    const files = finding.files.length ? `${finding.files.length} file${finding.files.length === 1 ? '' : 's'}: ${finding.files.slice(0, 20).join(', ')}${finding.files.length > 20 ? `, … ${finding.files.length - 20} more` : ''}` : '';
    return {
      key,
      kind: finding.kind,
      title: `${kindLabel(finding.kind)}: step ${finding.step}`,
      files: finding.files,
      evidence: [`step ${finding.step}${finding.rung ? ` (${finding.rung})` : ''}: ${clip(withoutMachinePaths(finding.detail), 1200)}`, ...(files ? [files] : [])].join('\n'),
      source: 'run',
      steps: [...steps],
      weight: Math.max(1, finding.files.length),
    };
  });
  return [...merged, ...ofRung, ...ofStep];
}

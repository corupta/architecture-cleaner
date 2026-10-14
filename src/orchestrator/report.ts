// report.md of a run: what happened, how long each step and rung took, the verdicts, totals and cost. A pure
// function of run.json; the findings section is a seam (src/findings renders the full log in round 2).
import type { AttemptRecord, BisectRecord, RunState, StepRecord } from './types.js';

export interface ReportOptions {
  /** Renders the findings section's body (markdown); default: the run's findings as a list grouped by kind. */
  findings?: (state: RunState) => string;
  /** The findings log's narration: what its calls cost when recorded, and whether this run replayed them. */
  narration?: { costUsd: number; calls: number; replayed: boolean } | null;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 59_950) return `${(milliseconds / 1000).toFixed(1)} s`;
  const seconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} m ${String(seconds % 60).padStart(2, '0')} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} m`;
}

const money = (usd: number) => `$${usd.toFixed(4)}`;
const short = (sha: string | undefined) => (sha ? sha.slice(0, 10) : '–');
const code = (text: string) => `\`${text}\``;
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const sum = (attempts: AttemptRecord[], key: keyof AttemptRecord['timings']) => attempts.reduce((total, attempt) => total + (attempt.timings[key] ?? 0), 0);

function defaultFindings(state: RunState): string {
  if (!state.findings.length) return 'None.';
  const byKind = new Map<string, typeof state.findings>();
  for (const finding of state.findings) byKind.set(finding.kind, [...(byKind.get(finding.kind) ?? []), finding]);
  const lines: string[] = [];
  for (const [kind, findings] of byKind) {
    lines.push(`- **${kind}** (${findings.length})`);
    for (const finding of findings.slice(0, 20)) {
      const where = finding.step !== undefined ? `step ${finding.step}: ` : finding.rung ? `${finding.rung}: ` : '';
      const files = finding.files.length ? `${finding.files.slice(0, 4).map(code).join(', ')}${finding.files.length > 4 ? ` +${finding.files.length - 4}` : ''}: ` : '';
      lines.push(`  - ${where}${files}${cell(finding.detail).slice(0, 300)}`);
    }
    if (findings.length > 20) lines.push(`  - … ${findings.length - 20} more`);
  }
  return lines.join('\n');
}

function bisectOutcome(bisect: BisectRecord): string {
  if (bisect.firstFailingStep !== null) return `step ${bisect.firstFailingStep} pinned`;
  const last = bisect.probes.at(-1)!;
  return `no evidence at step ${last.step} (K8 ${last.k8}), nothing pinned`;
}

function stepOutcome(step: StepRecord): string {
  const replans = step.attempts.filter((attempt) => attempt.state !== 'passed' && attempt.state !== 'interrupted').length;
  const fault = step.attempts.some((attempt) => attempt.injectedFault) ? ', injected fault' : '';
  if (step.status === 'certified') return replans ? `certified after ${replans} replan${replans === 1 ? '' : 's'}${fault}` : `certified${fault}`;
  return `${step.status}${fault}`;
}

export function renderReport(state: RunState, options: ReportOptions = {}): string {
  const lines: string[] = [];
  const scope = state.packageRoot ? `${state.packageRoot}/` : '.';
  const timeline = state.timeline;
  lines.push(`# ac run: ${code(scope)} @ ${code(short(state.base))} on ${code(state.branch)}`, '');
  const exit = state.status === 'declined' ? 3 : state.status === 'failed' ? 1 : 0;
  const failure = state.status === 'failed' && state.failure ? (state.failure === 'verdict' ? ', a verdict: final' : ', a crash: --resume continues') : '';
  lines.push(`- Status: **${state.status}** (exit ${exit}${failure})${state.error ? `: ${cell(state.error.split('\n')[0]!)}` : ''}`);
  lines.push(`- Repository ${code(state.repo)}, environment ${code(state.environment)}, profile ${code(state.profile.name)}`);
  lines.push(`- Plan: ${code(state.plan.source)} (sha256 ${code(state.plan.sha256.slice(0, 12))}), ${state.plan.steps} steps, ${state.plan.moves} moves`);
  lines.push(`- Commits: ${code(short(state.base))} → ${code(short(state.head))}`);
  lines.push(`- Wall time: **${formatDuration(timeline.durationMs)}** (preflight ${formatDuration(timeline.preflightMs)}, baseline ${formatDuration(timeline.baselineMs)}, steps ${formatDuration(timeline.stepsMs)}, rung certificates ${formatDuration(timeline.rungCertificationMs)}${timeline.bisectMs ? `, bisect ${formatDuration(timeline.bisectMs)}` : ''}, whole-PR certificate ${formatDuration(timeline.runCertificationMs)})${timeline.resumedAt.length ? `, resumed ${timeline.resumedAt.length}×` : ''}`);
  const spend = state.cost.mode === 'replay' ? `${money(state.cost.llmUsd)} (replayed from the cassette)` : state.cost.budgetRun ? `${money(state.cost.llmUsd)} (budget run ${code(state.cost.budgetRun)})` : `${money(state.cost.llmUsd)} (no planner call: the plan came from a file)`;
  const { narration } = options;
  const narrated = narration ? `; findings narration ${money(narration.costUsd)} in ${narration.calls} call${narration.calls === 1 ? '' : 's'}${narration.replayed ? ' when recorded (replayed: $0 now)' : ''}` : '';
  lines.push(`- Cost: planner LLM spend of this run ${spend}${narrated}; the plan cost ${state.cost.planRecordedUsd === null ? 'unknown' : money(state.cost.planRecordedUsd)} when it was recorded`);
  if (state.fault) {
    const { fault } = state;
    const recovered = fault.appliedTo !== undefined ? state.steps.find((step) => step.index === fault.appliedTo)?.status : undefined;
    lines.push(`- Injected fault (${code(`--inject-fault ${fault.step}:${fault.operator}`)}): ${fault.appliedTo !== undefined ? `applied to step ${fault.appliedTo}, ${cell(fault.description ?? '')}; the step ended ${recovered}` : `not applied${fault.notApplied ? `: ${cell(fault.notApplied)}` : ''}`}`);
  }
  if (state.certificate) lines.push(`- Whole PR: **${state.certificate.verdict.toUpperCase()}** (${state.certificate.scope}) ${code(state.certificate.file)}, digest ${code(state.certificate.digest.slice(0, 19))}`);
  lines.push('');

  lines.push('## Rungs', '', '| Rung | Status | Steps | Commits | Certificate | Duration |', '|---|---|---|---|---|---|');
  for (const rung of state.rungs) {
    const steps = state.steps.filter((step) => step.rung === rung.id);
    const count = (status: StepRecord['status']) => steps.filter((step) => step.status === status).length;
    const stepCell = rung.id === 'R0' ? '–' : `${steps.length} (${count('certified')} certified, ${count('pinned')} pinned, ${count('skipped')} skipped${count('pending') ? `, ${count('pending')} pending` : ''})`;
    const certificate = rung.certificate ? `${rung.certificate.verdict.toUpperCase()} (${rung.certificate.scope}${rung.certificate.partial ? ', partial' : ''}) ${code(rung.certificate.file)}` : rung.note ? cell(rung.note).slice(0, 200) : '–';
    const bisect = rung.bisect ? `; K8 bisect: ${bisectOutcome(rung.bisect)} (${rung.bisect.probes.length} probes, ${formatDuration(rung.bisect.durationMs)})` : '';
    lines.push(`| ${rung.id} | ${rung.status} | ${stepCell} | ${rung.id === 'R0' ? '–' : count('certified')} | ${certificate}${bisect} | ${formatDuration(rung.durationMs)} |`);
  }
  lines.push('');

  const ran = state.steps.filter((step) => step.attempts.length || step.status !== 'pending');
  lines.push('## Steps', '');
  if (!ran.length) lines.push('No step ran.');
  else {
    lines.push('| # | Rung | Group | Outcome | Attempts | Files moved | Specifier edits | Move | Certify | Total | Certificate |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const step of ran) {
      const counts = step.counts ? `${step.counts.specifierEdits} in ${step.counts.filesEdited} files` : '–';
      const certificate = step.certificate ? `${step.certificate.verdict.toUpperCase()} ${code(step.certificate.digest.replace(/^sha256:/, '').slice(0, 10))}` : '–';
      lines.push(`| ${step.index} | ${step.rung} | ${step.group} | ${stepOutcome(step)} | ${step.attempts.length} | ${step.counts?.filesMoved ?? '–'} | ${counts} | ${formatDuration(sum(step.attempts, 'moveMs'))} | ${formatDuration(sum(step.attempts, 'certifyMs'))} | ${formatDuration(step.durationMs)} | ${certificate} |`);
    }
    const failed = ran.flatMap((step) => step.attempts.filter((attempt) => attempt.state !== 'passed').map((attempt) => ({ step, attempt })));
    if (failed.length) {
      lines.push('', '### Failed attempts', '', '| # | Attempt | State | Pinned | Detail |', '|---|---|---|---|---|');
      for (const { step, attempt } of failed) {
        lines.push(`| ${step.index} | ${attempt.attempt}${attempt.injectedFault ? ' (injected fault)' : ''} | ${attempt.state} | ${attempt.pinned.length} | ${cell(attempt.detail).slice(0, 300)} |`);
      }
    }
  }
  lines.push('');

  const certified = state.steps.filter((step) => step.status === 'certified');
  const attempts = state.steps.flatMap((step) => step.attempts);
  lines.push('## Totals', '');
  lines.push(`- ${certified.length} certified commits, ${state.steps.filter((step) => step.status === 'pinned').length} steps pinned, ${state.steps.filter((step) => step.status === 'skipped').length} skipped, ${state.steps.filter((step) => step.status === 'pending').length} pending`);
  lines.push(`- ${certified.reduce((total, step) => total + (step.counts?.filesMoved ?? 0), 0)} files moved, ${certified.reduce((total, step) => total + (step.counts?.specifierEdits ?? 0), 0)} specifier edits`);
  lines.push(`- ${attempts.length} attempts: ${attempts.filter((attempt) => attempt.state === 'declined' || attempt.state === 'unverified').length} declined by the executor, ${attempts.filter((attempt) => attempt.state === 'failed').length} failed certification (rolled back), ${attempts.filter((attempt) => attempt.state === 'interrupted').length} interrupted`);
  lines.push(`- ${state.pins.length} files pinned`, '');

  if (state.pins.length) {
    lines.push('## Pins', '', '| File | Step | Reason |', '|---|---|---|');
    for (const pin of state.pins) lines.push(`| ${code(pin.file)} | ${pin.step} ${pin.group} | ${pin.reason} |`);
    lines.push('');
  }

  lines.push('## Findings', '', (options.findings ?? defaultFindings)(state), '');
  return `${lines.join('\n')}\n`;
}

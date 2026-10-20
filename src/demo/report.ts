// What a demo did, phase by phase, and its summary (<work>/demo.md and the console): what was re-executed on this
// machine, what was replayed from the cassette, and what was not re-run, each with its numbers and where they come from.
import type { CheckId, CheckStatus } from '../certificate/types.js';
import type { ModelKey } from '../gateway/types.js';
import type { RungId } from '../orchestrator/types.js';
import type { BoundaryStep, ExecutedStep } from './ladder.js';

/** match: equal to the recorded run; mismatch: different; failed: couldn't be computed; skipped: not asked for. */
export type Outcome = 'match' | 'mismatch' | 'failed' | 'skipped';

export interface ModelCall {
  model: ModelKey;
  /** The request's schema name: plan_edit, plan_review, findings_narration, ... */
  purpose: string;
  replayed: boolean;
  costUsd: number;
}

export interface FileComparison {
  file: string;
  identical: boolean;
  /** The one recorded difference that was allowed for. */
  note?: string;
}

export interface PlanPhase {
  outcome: Outcome;
  /** sha256 of the plan.yaml made here, and the one the recorded run executed (null in live mode). */
  sha256: string | null;
  recordedSha256: string | null;
  groups: number;
  steps: number;
  files: FileComparison[];
  calls: ModelCall[];
  /** What the plan cost when it was recorded (live: what it cost now). */
  recordedCostUsd: number | null;
  directory: string;
  detail?: string;
}

export interface StepEntry extends ExecutedStep {
  /** The recorded run's tree for this step (replay). */
  recordedTree?: string;
}

export interface CheckComparison {
  id: CheckId;
  status: CheckStatus;
  /** The recorded certificate's status for the check (null: not in it, or no recorded certificate). */
  recorded: CheckStatus | null;
  /** The check's content as the digest reads it equals the recorded check's; null: not compared (skipped on either side, or not recorded). */
  identical: boolean | null;
  skipReason?: string;
}

export interface CertifiedEntry {
  /** A step index, or 'whole PR'. */
  subject: number | 'whole PR';
  rung?: RungId;
  group?: string;
  /** Why it is in the sample (first step, largest step, an R3 rename, spread). */
  reason: string;
  verdict: 'pass' | 'fail';
  scope: 'full' | 'static';
  checks: CheckComparison[];
  digest: string;
  recordedDigest: string | null;
  /** Work-dir-relative certificate files written here. */
  file: string;
  durationMs: number;
}

export interface RenamePhase {
  outcome: Outcome;
  steps: number;
  renames: number;
  declined: number;
  detail?: string;
}

export interface FindingsPhase {
  outcome: Outcome;
  findings: number;
  narrated: number;
  calls: ModelCall[];
  files: FileComparison[];
  detail?: string;
}

export interface DemoReport {
  mode: 'replay' | 'live' | 'full';
  target: {
    name: string; sha: string; packageRoot: string; checkout: string; source: string; environment: string | null; branch: string;
    /** node_modules above the environment checkout (hermetic.ts nodeModulesAbove; empty without one). */
    environmentNodeModulesAbove: string[];
  };
  /** The recorded run compared with (replay and full). */
  recorded: { directory: string; branch: string; steps: number; head: string; wholePrDigest: string | null } | null;
  plan: PlanPhase;
  steps: StepEntry[];
  /** Steps the plan and R3 had in total, and where --steps stopped (null: all ran). */
  plannedSteps: number;
  stoppedAfter: number | null;
  renames: RenamePhase | null;
  boundaries: (BoundaryStep & StepEntry) | null;
  certified: CertifiedEntry[];
  findings: FindingsPhase | null;
  /** --full: how `ac run` ended (completed, stopped by --steps, failed, declined) and why. */
  run?: { status: string; error?: string };
  /** Live LLM spend of this demo (replay: 0). */
  spentUsd: number;
  /** Lines for "not re-run here". */
  notRerun: string[];
  workDir: string;
  durationMs: number;
}

const short = (sha: string | undefined | null) => (sha ? sha.slice(0, 10) : '-');
const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;
const usd = (value: number) => `$${value.toFixed(4)}`;
const modelNames: Record<ModelKey, string> = { ultra: 'Nemotron 3 Ultra', lightning: 'Nemotron 3.5 Lightning', super: 'Nemotron 3 Super' };

/** `2 Nemotron 3 Ultra calls (plan_edit, plan_review)`. */
export function describeCalls(calls: ModelCall[]): string {
  const byModel = new Map<ModelKey, ModelCall[]>();
  for (const call of calls) byModel.set(call.model, [...(byModel.get(call.model) ?? []), call]);
  return [...byModel].map(([model, list]) => `${plural(list.length, `${modelNames[model]} call`)} (${list.map((call) => call.purpose).join(', ')})`).join(' and ') || 'no model call';
}

const moveSteps = (report: DemoReport) => report.steps.filter((step) => step.rung !== 'R4');
const treeMatches = (step: StepEntry) => step.outcome === 'committed' && step.recordedTree !== undefined && step.tree === step.recordedTree;
const subjectOf = (entry: CertifiedEntry) => (entry.subject === 'whole PR' ? 'the whole PR' : `step ${entry.subject}`);
const idList = (checks: CheckComparison[]) => checks.map((check) => check.id).join(', ');

/** The checks that run the target's own tools from its node_modules: without --env they skip, and that is no difference. */
export const environmentChecks: readonly CheckId[] = ['K3b', 'K3c', 'K6', 'K8'];

/** Skipped here although the recorded certificate ran it, and no missing environment explains it. */
const unexplainedSkip = (report: DemoReport, check: CheckComparison) => check.status === 'skip' && check.recorded !== null && check.recorded !== 'skip'
  && (report.target.environment !== null || !environmentChecks.includes(check.id));

/**
 * The demo certified with an environment like the recording's: --env, the target's node_modules. Only then can a
 * check's content and the digest be compared; without it, only the statuses are. The work dir is always hermetic (the
 * certifier refuses any other), so nothing above it reaches the certificates.
 */
const comparableEnvironment = (report: DemoReport) => report.target.environment !== null;

/** The same checks ran on both sides (and the same ones skipped): the digests must then be equal. */
export const digestComparable = (entry: CertifiedEntry) => entry.recordedDigest !== null
  && entry.checks.every((check) => check.recorded !== null && (check.status === 'skip') === (check.recorded === 'skip'));

/** How a certificate differs from the recorded one; empty when everything compared is equal. */
function certificateDifferences(report: DemoReport, entry: CertifiedEntry): string[] {
  const found: string[] = [];
  const subject = subjectOf(entry);
  if (entry.verdict !== 'pass') found.push(`${subject}: certificate FAIL (${idList(entry.checks.filter((check) => check.status === 'fail' || check.status === 'error'))})`);
  if (!report.recorded) return found;
  if (entry.recordedDigest === null) return [...found, `${subject}: no recorded certificate to compare with`];
  const disagree = entry.checks.filter((check) => check.recorded !== null && check.status !== 'skip' && check.recorded !== 'skip' && check.status !== check.recorded);
  if (disagree.length) found.push(`${subject}: ${disagree.map((check) => `${check.id} ${check.status}, recorded ${check.recorded}`).join('; ')}`);
  const changed = entry.checks.filter((check) => check.identical === false && check.status === check.recorded);
  if (comparableEnvironment(report) && changed.length) found.push(`${subject}: ${changed.map((check) => `${check.id} ${check.status} as recorded, but its content differs from the recorded check's`).join('; ')}`);
  const skips = entry.checks.filter((check) => unexplainedSkip(report, check));
  if (skips.length) found.push(`${subject}: ${skips.map((check) => `${check.id} skipped here (${check.skipReason ?? 'no reason given'}), recorded ${check.recorded}`).join('; ')}`);
  // A check that differs changes the digest too; a digest that differs while every check is equal is its own difference.
  if (!found.length && comparableEnvironment(report) && digestComparable(entry) && entry.digest !== entry.recordedDigest) {
    found.push(`${subject}: digest ${entry.digest.slice(0, 19)}… differs from the recorded ${entry.recordedDigest.slice(0, 19)}… with the same checks run`);
  }
  return found;
}

/** What the comparison with the recorded run left out: checks skipped on either side, and content and digests it couldn't compare. */
export function notCompared(report: DemoReport): string[] {
  if (!report.recorded) return [];
  const groups = new Map<string, { checks: string; where: string; certificates: number }>();
  const count = (checks: string, where: string) => {
    if (!checks) return;
    const group = groups.get(`${checks} ${where}`) ?? { checks, where, certificates: 0 };
    group.certificates++;
    groups.set(`${checks} ${where}`, group);
  };
  for (const entry of report.certified) {
    count(idList(entry.checks.filter((check) => check.status === 'skip' && check.recorded !== null && check.recorded !== 'skip')), 'skipped here');
    count(idList(entry.checks.filter((check) => check.status !== 'skip' && check.recorded === 'skip')), 'skipped in the recorded certificate');
  }
  const recorded = report.certified.filter((entry) => entry.recordedDigest !== null);
  const digests = recorded.filter((entry) => !digestComparable(entry)).length;
  return [
    ...[...groups.values()].map((group) => `${group.checks} on ${plural(group.certificates, 'certificate')} (${group.where})`),
    ...(!comparableEnvironment(report) && recorded.length
      ? [`the checks' content and the digest of ${plural(recorded.length, 'certificate')}, without --env (the recording had the target's node_modules)`]
      : digests ? [`the digest of ${plural(digests, 'certificate')}, which needs the same checks run on both sides`] : []),
  ];
}

/** Every way the demo's results differ from the recorded run, or failed; empty when everything compared matched. */
export function differences(report: DemoReport): string[] {
  const found: string[] = [];
  if (report.run && report.run.status !== 'completed' && report.run.status !== 'stopped') {
    found.push(`\`ac run\` ended ${report.run.status}${report.run.error ? `: ${report.run.error.split('\n')[0]}` : ''}`);
  }
  if (report.plan.outcome === 'mismatch' || report.plan.outcome === 'failed') {
    found.push(`plan: ${report.plan.detail ?? report.plan.files.filter((file) => !file.identical).map((file) => `${file.file} differs`).join(', ')}`);
  }
  for (const step of report.steps) {
    if (step.outcome !== 'committed') found.push(`step ${step.index} (${step.group}): ${step.outcome}: ${step.detail ?? ''}`);
    else if (report.mode !== 'live' && !treeMatches(step)) found.push(`step ${step.index} (${step.group}): tree ${short(step.tree)}, recorded ${short(step.recordedTree)}`);
  }
  if (report.renames && (report.renames.outcome === 'mismatch' || report.renames.outcome === 'failed')) found.push(`R3: ${report.renames.detail ?? report.renames.outcome}`);
  const vacuity = report.boundaries?.antiVacuity;
  if (vacuity && vacuity.fired < vacuity.rules) found.push(`R4: ${vacuity.rules - vacuity.fired} of ${vacuity.rules} rules never fired on their synthetic violation (\`ac run\` fails R4 on that)`);
  for (const entry of report.certified) found.push(...certificateDifferences(report, entry));
  if (report.findings && (report.findings.outcome === 'mismatch' || report.findings.outcome === 'failed')) {
    found.push(`findings: ${report.findings.detail ?? report.findings.files.filter((file) => !file.identical).map((file) => `${file.file} differs`).join(', ')}`);
  }
  return found;
}

function certifiedLines(report: DemoReport): string[] {
  return report.certified.map((entry) => {
    const ran = entry.checks.filter((check) => check.status !== 'skip');
    const skipped = entry.checks.filter((check) => check.status === 'skip');
    const subject = entry.subject === 'whole PR' ? `the whole PR (${short(report.target.sha)}..${short(report.steps.at(-1)?.commit)})` : `step ${entry.subject} (${entry.rung} ${entry.group}, ${entry.reason})`;
    const parts = [`ran ${ran.map((check) => `${check.id} ${check.status}`).join(', ')}`];
    if (skipped.length) parts.push(`skipped ${idList(skipped)}`);
    const recordedDigest = entry.recordedDigest;
    if (report.recorded && recordedDigest === null) parts.push('no recorded certificate');
    else if (report.recorded && recordedDigest !== null) {
      const compared = ran.filter((check) => check.recorded !== null && check.recorded !== 'skip');
      const sameStatus = compared.filter((check) => check.status === check.recorded);
      const notCompared = [...skipped, ...ran.filter((check) => !compared.includes(check))];
      if (sameStatus.length) parts.push(`status as recorded: ${idList(sameStatus)}`);
      if (comparableEnvironment(report)) {
        const identical = entry.checks.filter((check) => check.identical === true);
        const different = entry.checks.filter((check) => check.identical === false);
        if (identical.length) parts.push(`content as recorded, byte for byte: ${idList(identical)}`);
        if (different.length) parts.push(`content different from the recorded: ${idList(different)}`);
      }
      if (notCompared.length) parts.push(`not compared: ${idList(notCompared)}`);
      parts.push(!comparableEnvironment(report) ? 'content and digest not compared without --env'
        : !digestComparable(entry) ? 'digest not compared (not the same checks run)'
          : entry.digest === recordedDigest ? `digest ${entry.digest.slice(0, 19)}… identical to the recorded certificate's`
            : `digest ${entry.digest.slice(0, 19)}… differs from the recorded ${recordedDigest.slice(0, 19)}…`);
    }
    return `- ${subject}: **${entry.verdict.toUpperCase()}** (${entry.scope}); ${parts.join('; ')}. \`${entry.file}\``;
  });
}

export function demoMarkdown(report: DemoReport): string {
  const lines: string[] = [];
  const { target, plan, recorded } = report;
  const title = report.mode === 'live' ? 'ac demo --live' : report.mode === 'full' ? 'ac demo --full' : 'ac demo --replay';
  lines.push(`# ${title}: ${target.name} ${target.packageRoot ? `${target.packageRoot}/ ` : ''}@ ${short(target.sha)}`, '');
  const found = differences(report);
  if (report.mode === 'live') {
    lines.push(found.length ? `**${plural(found.length, 'problem')}** (listed at the end).` : 'Every step that ran committed, and every certificate in the sample passed.', '');
  } else {
    const left = notCompared(report);
    lines.push(found.length
      ? `**${plural(found.length, 'difference')} from the recorded run** (listed at the end).`
      : `**Everything compared matches the recorded run** (\`${recorded?.directory}\`, branch \`${recorded?.branch}\`).${left.length ? ` Not compared: ${left.join('; ')}.` : ''}`, '');
  }
  lines.push(`Checkout: \`${target.checkout}\`, ${target.source}. Branch \`${target.branch}\`. Work dir: \`${report.workDir}\`.`, '');
  const above = target.environmentNodeModulesAbove;
  if (above.length) {
    lines.push(`The environment \`${target.environment}\` has ${above.map((entry) => `\`${entry}\``).join(', ')} above it. Node resolves an installed package's own imports from `
      + `the package's real path, so an import the environment doesn't satisfy is looked up there. What the target's tools load (K3b, K3c, K6, K8) can then differ from the recording.`, '');
  }

  lines.push('## Re-executed on this machine', '');
  lines.push(`- **The planner's deterministic part**: facts, the seeds draft, the validator and the critic's gate on the checkout; plan.yaml${plan.sha256 ? ` sha256 \`${plan.sha256.slice(0, 12)}…\`` : ''}, ${plural(plan.groups, 'group')}, ${plural(plan.steps, 'step')}.`);
  if (report.mode === 'live' && plan.detail) lines.push(`- **Nemotron's new plan** (its calls are listed below): ${plan.detail}.`);
  const moves = moveSteps(report);
  const byRung = (['R1', 'R2', 'R3'] as const).map((rung) => [rung, moves.filter((step) => step.rung === rung).length] as const).filter(([, count]) => count);
  const matched = moves.filter(treeMatches).length;
  const stopped = report.stoppedAfter !== null ? ` (stopped after step ${report.stoppedAfter} by --steps)` : '';
  lines.push(`- **The executor**: ${moves.length} of ${report.plannedSteps} move steps${stopped} (${byRung.map(([rung, count]) => `${rung} ${count}`).join(', ') || 'none'}), one commit each on \`${target.branch}\`; `
    + `${moves.reduce((sum, step) => sum + (step.counts?.filesMoved ?? 0), 0).toLocaleString('en-US')} files moved, ${moves.reduce((sum, step) => sum + (step.counts?.specifierEdits ?? 0), 0).toLocaleString('en-US')} specifier edits.`
    + (report.mode === 'live' ? '' : ` **${matched} of ${moves.length} trees equal the recorded run's.**`));
  if (report.renames) {
    lines.push(`- **R3's renames**, computed on the tree after R2: ${plural(report.renames.steps, 'step')}, ${plural(report.renames.renames, 'rename')}, ${report.renames.declined} declined${report.renames.outcome === 'match' ? '; the same steps as the recorded run' : report.renames.detail ? `; ${report.renames.detail}` : ''}.`);
  }
  if (report.boundaries) {
    const r4 = report.boundaries;
    lines.push(r4.outcome === 'committed'
      ? `- **R4's boundary rules**, generated${report.mode === 'live' ? '' : ' again'}: ${r4.antiVacuity ? `${r4.antiVacuity.fired}/${r4.antiVacuity.rules} rules fired on their synthetic violation` : ''}; `
        + `${report.mode === 'live' ? 'committed' : treeMatches(r4) ? 'the commit\'s tree equals the recorded R4 tree' : `tree ${short(r4.tree)}, recorded ${short(r4.recordedTree)}`}.`
      : `- **R4's boundary rules** could not be generated here: ${r4.detail}.`);
  }
  if (report.certified.length) {
    lines.push(`- **Certificates** (\`ac certify\`, the checker that never imports the executor):`);
    lines.push(...certifiedLines(report).map((line) => `  ${line}`));
  }
  if (report.findings && report.findings.outcome !== 'skipped') {
    lines.push(`- **The findings collectors** over the base commit and the recorded certificates: ${plural(report.findings.findings, 'finding')}, ${report.findings.narrated} narrated.`);
  }
  lines.push('');

  const replayedCalls = [...plan.calls, ...(report.findings?.calls ?? [])].filter((call) => call.replayed);
  const liveCalls = [...plan.calls, ...(report.findings?.calls ?? [])].filter((call) => !call.replayed);
  if (replayedCalls.length) {
    lines.push('## Replayed from the cassette (no key, $0)', '');
    if (plan.calls.some((call) => call.replayed)) {
      const identical = plan.files.filter((file) => file.identical).length;
      lines.push(`- **The plan**: ${describeCalls(plan.calls)}. ${plan.recordedSha256 ? `plan.yaml's sha256 ${plan.sha256 === plan.recordedSha256 ? 'equals' : 'differs from'} the recorded run's (\`${plan.recordedSha256.slice(0, 12)}…\`); ` : ''}`
        + `${plan.files.length ? `${identical} of ${plan.files.length} plan files byte-identical (${plan.files.map((file) => file.file).join(', ')}).` : ''}`
        + `${plan.recordedCostUsd !== null ? ` Recorded cost: ${usd(plan.recordedCostUsd)}.` : ''}`);
    }
    if (report.findings?.calls.some((call) => call.replayed)) {
      const identical = report.findings.files.filter((file) => file.identical).length;
      const notes = [...new Set(report.findings.files.flatMap((file) => (file.note ? [file.note] : [])))];
      lines.push(`- **The findings narration**: ${describeCalls(report.findings.calls)}; ${identical} of ${report.findings.files.length} findings files byte-identical (${report.findings.files.map((file) => file.file).join(', ')})`
        + `${notes.length ? `, ${notes.join('; ')}: the narration was recorded live in the run, and a replay says it is one` : ''}.`);
    }
    lines.push('');
  }
  if (liveCalls.length) {
    lines.push(`## Live calls on your key (${usd(report.spentUsd)})`, '', `- ${describeCalls(liveCalls)}; ledger \`${report.workDir}/budget/ledger.jsonl\`, cassette \`${report.workDir}/live-cassette.jsonl\`.`, '');
  }

  lines.push('## Not re-run here', '', ...report.notRerun.map((line) => `- ${line}`), '');
  if (found.length) lines.push(report.mode === 'live' ? '## Problems' : '## Differences', '', ...found.map((line) => `- ${line}`), '');
  return `${lines.join('\n').trimEnd()}\n`;
}

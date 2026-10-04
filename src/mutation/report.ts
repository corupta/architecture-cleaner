// report.md for a harness run: controls, the kill matrix (operator × target), kills per check, survivors with their
// diffs, capped instances and operators that had nothing to mutate.
import type { CheckId } from '../certificate/types.js';
import type { HarnessResult, MutantRecord } from './harness.js';
import { operators } from './operators.js';

const percent = (part: number, whole: number) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : 'n/a');

function cell(mutants: MutantRecord[]): string {
  if (!mutants.length) return '';
  const killed = mutants.filter((mutant) => !mutant.effectivelySurvived).length;
  return `${killed}/${mutants.length}${killed < mutants.length ? ' !' : ''}`;
}

export function renderReport(result: HarnessResult): string {
  const lines: string[] = [];
  const { mutants, controls } = result;
  const survivors = mutants.filter((mutant) => mutant.survived);
  const effectiveSurvivors = mutants.filter((mutant) => mutant.effectivelySurvived);
  const errorOnly = mutants.filter((mutant) => !mutant.survived && mutant.killedBy.length === 0);
  lines.push('# Mutation harness report', '');
  lines.push(`Started ${result.startedAt}; ${(result.durationMs / 1000).toFixed(0)} s. Checks: ${result.checks.join(', ')} (no K8). Cap: ${result.cap} instances per operator variant and subject.`);
  lines.push(result.staged
    ? 'Staged: the tree-only checks (K0, K1, K2, K3a, K4) run first; the runner/runtime checks (K3b, K3c, K6) run only on mutants the first stage did not kill, so "Killers seen" undercounts the second stage. Controls run every check.'
    : 'Exhaustive: every check ran on every mutant.', '');
  lines.push(`- Mutants: ${mutants.length}`);
  lines.push(`- Killed: ${mutants.length - effectiveSurvivors.length} (${percent(mutants.length - effectiveSurvivors.length, mutants.length)}); target 100%`);
  lines.push(`- Survived (verdict PASS): ${survivors.length}`);
  lines.push(`- Survived once kills explained by the control are discounted (a check that rejects the good head counts only for violations the good head doesn't have): ${effectiveSurvivors.length}`);
  lines.push(`- Rejected only by a crashing check (no failing check): ${errorOnly.length}`);
  lines.push('');

  lines.push('## Controls (each known-good result must certify PASS)', '');
  lines.push('| Subject | Verdict | Failing checks | Time | Per check |', '|---|---|---|---|---|');
  for (const control of controls) {
    const perCheck = Object.entries(control.checkDurationsMs).map(([check, milliseconds]) => `${check} ${(milliseconds! / 1000).toFixed(1)}`).join(', ');
    lines.push(`| ${control.subject}${control.kind ? ` (${control.kind})` : ''} | ${control.verdict.toUpperCase()} | ${control.failing.join(', ') || '-'} | ${(control.durationMs / 1000).toFixed(1)} s | ${perCheck} |`);
  }
  const failedControls = controls.filter((control) => control.verdict !== 'pass');
  if (failedControls.length) {
    lines.push('', 'A failing control invalidates its row: a check that rejects the good head only counts as a killer where it reports a violation the good head does not have.', '');
    for (const control of failedControls) {
      for (const [check, violations] of Object.entries(control.violations)) lines.push(`- ${control.subject} ${check}: ${violations!.join(' | ')}`);
    }
  }
  lines.push('');

  const targets = [...new Set(mutants.map((mutant) => mutant.target))];
  const operatorIds = [...operators.map((operator) => operator.id), 'hunt'].filter((id) => mutants.some((mutant) => mutant.operator === id));
  lines.push('## Kill matrix (killed/total; `!` marks survivors)', '');
  lines.push(`| Operator | ${targets.join(' | ')} | Total | Expected killers (04b) | Killers seen |`, `|---|${targets.map(() => '---|').join('')}---|---|---|`);
  for (const id of operatorIds) {
    const operator = operators.find((candidate) => candidate.id === id);
    const ofOperator = mutants.filter((mutant) => mutant.operator === id);
    const row = targets.map((target) => cell(ofOperator.filter((mutant) => mutant.target === target)));
    const seen = new Map<string, number>();
    for (const mutant of ofOperator) for (const check of mutant.effectiveKilledBy) seen.set(check, (seen.get(check) ?? 0) + 1);
    const killers = [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([check, count]) => `${check}×${count}`).join(' ');
    lines.push(`| ${id} ${operator?.title ?? 'S3 hunt corpus'} | ${row.join(' | ')} | ${cell(ofOperator)} | ${operator?.expectedKillers ?? 'per case.json'} | ${killers} |`);
  }
  lines.push(`| **Total** | ${targets.map((target) => cell(mutants.filter((mutant) => mutant.target === target))).join(' | ')} | ${cell(mutants)} | | |`, '');

  lines.push('## Kills per check', '');
  lines.push('| Check | Kills | Sole killer |', '|---|---|---|');
  const checks = [...new Set(mutants.flatMap((mutant) => mutant.effectiveKilledBy))].sort() as CheckId[];
  for (const check of checks) {
    const kills = mutants.filter((mutant) => mutant.effectiveKilledBy.includes(check)).length;
    const sole = mutants.filter((mutant) => mutant.effectiveKilledBy.length === 1 && mutant.effectiveKilledBy[0] === check).length;
    lines.push(`| ${check} | ${kills} | ${sole} |`);
  }
  lines.push('');

  lines.push('## Survivors (soundness holes)', '');
  if (!effectiveSurvivors.length) lines.push('None.', '');
  for (const mutant of effectiveSurvivors) {
    lines.push(`### ${mutant.id}`, '');
    lines.push(`${mutant.description}`, '');
    lines.push(`Repo ${mutant.repo}, commit ${mutant.commit}. Statuses: ${Object.entries(mutant.statuses).map(([check, status]) => `${check}=${status}`).join(' ')}${mutant.killedBy.length ? ` (kills by ${mutant.killedBy.join(', ')} discounted: the same violations reject the control)` : ''}.`, '');
    lines.push('```diff', mutant.diff ?? '', '```', '');
  }

  if (errorOnly.length) {
    lines.push('## Rejected only by a crashing check', '');
    for (const mutant of errorOnly) lines.push(`- ${mutant.id}: ${mutant.erroredBy.map((check) => `${check}: ${mutant.violations[check]?.[0] ?? ''}`).join('; ')}`);
    lines.push('');
  }

  lines.push('## Capped instances', '');
  lines.push('Per operator variant and subject, candidates are ranked by a stable hash of their key and the first ones that apply are kept.', '');
  lines.push('| Subject | Operator | Candidates | Kept | Skipped as not applicable | Kept keys |', '|---|---|---|---|---|---|');
  for (const capped of result.capped) {
    lines.push(`| ${capped.subject} | ${capped.operator}${capped.variant ? `.${capped.variant}` : ''} | ${capped.candidates} | ${capped.kept} | ${capped.unbuildable} | ${capped.keptKeys.map((key) => `\`${key}\``).join(', ')} |`);
  }
  lines.push('');

  lines.push('## Not applicable (no instance on the subject)', '');
  const bySubject = new Map<string, string[]>();
  for (const { subject, operator } of result.notApplicable) bySubject.set(subject, [...(bySubject.get(subject) ?? []), operator]);
  for (const [subject, ids] of bySubject) lines.push(`- ${subject}: ${ids.join(', ')}`);
  lines.push('');

  if (result.issues.length) {
    lines.push('## Harness issues', '');
    for (const issue of result.issues) lines.push(`- ${issue.subject}${issue.operator ? ` ${issue.operator}` : ''}: ${issue.detail.split('\n')[0]}`);
    lines.push('');
  }
  return lines.join('\n');
}

// The findings log rendered: findings/findings.md (every finding, grouped by kind, narration then evidence), the PR
// description findings/pr-body.md (what the PR does in numbers, its certificates, how to verify them, the top
// findings, residual risk, the plan and its cost) and the body of report.md's "## Findings" section. Pure functions
// of the findings document and the run directory, so a replayed narration renders the same bytes.
import type { Certificate } from '../certificate/types.js';
import { formatDuration } from '../orchestrator/report.js';
import type { CertificateRecord, RunState } from '../orchestrator/types.js';
import { readPlanYaml } from '../planner/plan-file.js';
import { kindLabel, stepRanges } from './collect-records.js';
import type { RunData } from './run-data.js';
import type { Finding, FindingsDocument } from './types.js';

const groupLabels: Record<string, string> = {
  'module-cycle': 'Module cycles',
  'back-edge': 'Back-edges against the boundary order',
  'god-injection': 'God injection',
  'multi-writer-table': 'Tables written by several groups',
  'prod-imports-test': 'Production code importing test code',
  'plan-warning': 'Plan validator warnings',
};
export const groupLabel = (kind: string) => groupLabels[kind] ?? kindLabel(kind);

const code = (text: string) => `\`${text}\``;
const short = (sha: string) => sha.slice(0, 10);
const money = (usd: number) => `$${usd.toFixed(4)}`;
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const fileLimit = 12;
/** How many findings the PR body and the report section show in full. */
export const topFindingCount = 8;

/** Kinds in the order they are first seen in `findings` (already ranked). */
function kindsOf(findings: readonly Finding[]): Map<string, Finding[]> {
  const byKind = new Map<string, Finding[]>();
  for (const finding of findings) byKind.set(finding.kind, [...(byKind.get(finding.kind) ?? []), finding]);
  return byKind;
}

/** The best finding of each kind in rank order, then the second of each, ...: the top of a log without one kind crowding it. */
export function topFindings(findings: readonly Finding[], count: number): Finding[] {
  const queues = [...kindsOf(findings).values()];
  const top: Finding[] = [];
  for (let round = 0; top.length < count && queues.some((queue) => queue.length > round); round++) {
    for (const queue of queues) if (queue[round] && top.length < count) top.push(queue[round]!);
  }
  return top;
}

function reportedBy(finding: Finding): string {
  const parts = [...(finding.steps.length ? [`${finding.steps.length === 1 ? 'step' : 'steps'} ${stepRanges(finding.steps)}`] : []), ...finding.certificates];
  return parts.length ? ` · reported by ${parts.join(', ')}` : '';
}

/** The evidence as a text block; `maxLines` cuts it short with a pointer to the full log. */
function evidenceBlock(finding: Finding, maxLines = Number.POSITIVE_INFINITY): string[] {
  const lines = finding.evidence.split('\n');
  const shown = lines.length > maxLines ? [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines in findings/findings.md`] : lines;
  return ['```text', ...shown, '```'];
}
/** Evidence lines shown under each top finding of the PR body and the report section. */
const topEvidenceLines = 20;

function kindTable(document: FindingsDocument): string[] {
  const lines = ['| Kind | Findings | Source |', '|---|---|---|'];
  for (const [kind, findings] of kindsOf(document.findings)) lines.push(`| ${cell(groupLabel(kind))} | ${findings.length} | ${[...new Set(findings.map((finding) => finding.source))].join(', ')} |`);
  return lines;
}

function narrationLine(document: FindingsDocument): string {
  const record = document.narration;
  if (!record) return 'Narration: off; every finding shows its deterministic evidence only.';
  const spend = record.replayed ? `${money(record.costUsd)} when recorded, replayed now` : money(record.costUsd);
  const without = [
    ...(record.dropped.length ? [`${record.dropped.length} dropped by the guard`] : []),
    ...(record.notReturned.length ? [`${record.notReturned.length} not returned by the model`] : []),
  ];
  const dropped = without.length ? `, ${without.join(' and ')} (they keep their evidence only)` : '';
  return `Narration: ${record.label} wrote 1–2 sentences for ${record.narrated} findings in ${record.calls} call${record.calls === 1 ? '' : 's'} (${spend})${dropped}${record.error ? `; stopped early: ${cell(record.error)}` : ''}. Text only, under a lexical guard: it drops any narration naming a path, code identifier, capitalized name, the name in "the <name> table/module/class/…", or number (digits, or words up to twenty) that its evidence doesn't contain. It checks words, not claims: a number or name from the evidence can still be put to the wrong use.`;
}

export function findingsMarkdown(document: FindingsDocument): string {
  const { run } = document;
  const scope = run.packageRoot ? `${run.packageRoot}/` : '.';
  const lines = [
    `# Findings log: ${code(scope)} @ ${code(short(run.base))}`,
    '',
    'Recorded, never fixed. The run only moved files; every finding below describes the code as the run found it, and the run left it exactly as it was.',
    '',
    `- Run: branch ${code(run.branch)}, status ${run.status}, ${code(short(run.base))} → ${code(short(run.head))}, profile ${code(run.profile)}`,
    ...document.sources.map((source) => `- Source ${source.name}: ${source.detail}`),
    `- ${narrationLine(document)}`,
    '',
  ];
  if (!document.findings.length) return `${[...lines, 'No findings.'].join('\n')}\n`;
  lines.push(...kindTable(document), '');
  for (const [kind, findings] of kindsOf(document.findings)) {
    lines.push(`## ${groupLabel(kind)} (${findings.length})`, '');
    for (const finding of findings) {
      lines.push(`### ${finding.title}`, '', `${code(finding.id)} · ${finding.kind} · source ${finding.source}${reportedBy(finding)}`, '');
      if (finding.narration) lines.push(`> ${finding.narration}`, '');
      lines.push(...evidenceBlock(finding), '');
      if (finding.files.length) {
        const shown = finding.files.slice(0, fileLimit).map(code).join(', ');
        lines.push(`Files: ${shown}${finding.files.length > fileLimit ? `, … ${finding.files.length - fileLimit} more` : ''}`, '');
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function topList(findings: readonly Finding[]): string[] {
  return findings.flatMap((finding, index) => [
    `${index + 1}. **${finding.title}**${finding.narration ? `: ${finding.narration}` : ''}`,
    '',
    '   <details><summary>Evidence</summary>',
    '',
    ...evidenceBlock(finding, topEvidenceLines).map((line) => (line ? `   ${line}` : line)),
    '',
    '   </details>',
    '',
  ]);
}

/** The body of report.md's "## Findings" section. */
export function reportSection(document: FindingsDocument): string {
  if (!document.findings.length) return 'None. Full log: `findings/findings.md`.';
  return [
    `${document.findings.length} findings, recorded and never fixed. Full log: \`findings/findings.md\`; as JSON: \`findings/findings.json\`.`,
    '',
    narrationLine(document),
    '',
    ...kindTable(document),
    '',
    `Top ${Math.min(topFindingCount, document.findings.length)}:`,
    '',
    ...topList(topFindings(document.findings, topFindingCount)),
  ].join('\n').trimEnd();
}

function checksText(certificate: Certificate): string {
  const byStatus = new Map<string, string[]>();
  for (const check of certificate.checks) byStatus.set(check.status, [...(byStatus.get(check.status) ?? []), check.id]);
  return [...byStatus].map(([status, ids]) => `${status}: ${ids.join(' ')}`).join('; ');
}

/** A row for a certificate the findings log read (see `readCertificates`), or none for one of a commit the run threw away. */
function certificateRows(label: string, record: CertificateRecord & { partial?: boolean }, data: RunData): string[] {
  const certificate = data.certificates.find((stored) => stored.file === record.file)?.certificate;
  if (!certificate) return [];
  const verdict = `${record.verdict.toUpperCase()} (${record.scope}${record.partial ? ', partial' : ''})`;
  return [`| ${label} | ${code(`${short(record.base)}..${short(record.head)}`)} | ${verdict} | ${cell(checksText(certificate))} | ${code(`${record.digest.slice(0, 23)}…`)} |`];
}

/** The planner line: plan.md's "Planner: …" sentence, the recorded cost, and this run's own LLM spend. */
function planLine(state: RunState, planMarkdown: string | null): string {
  const planner = planMarkdown ? /Planner: ([^\n]+)/.exec(planMarkdown)?.[1]?.trim().replace(/\.$/, '') : undefined;
  const recorded = state.cost.planRecordedUsd === null ? 'an unknown cost' : money(state.cost.planRecordedUsd);
  const source = state.plan.source === 'planner' ? 'planned in this run' : `from ${code(state.plan.source.split('/').slice(-3).join('/'))}`;
  const spend = state.cost.mode === 'replay' || !state.cost.budgetRun ? `this run spent ${money(state.cost.llmUsd)} on it` : `this run spent ${money(state.cost.llmUsd)} (budget run ${code(state.cost.budgetRun)})`;
  return `Plan (${source}, sha256 ${code(state.plan.sha256.slice(0, 12))}): ${planner ?? 'a plan.yaml whose plan.md is not at hand'}. The plan cost ${recorded} when it was recorded; ${spend}. Nemotron only plans: every step is deterministic and certified.`;
}

/**
 * The Files line's edits. K2 of a certificate of exactly base..head counts distinct specifier spans and files over the
 * whole range; without one, the steps' own counts are summed, and a file that several steps edit counts once per step.
 */
function editsText(data: RunData, certified: RunState['steps']): string {
  const { state } = data;
  const records = [...(state.certificate ? [state.certificate] : []), ...state.rungs.flatMap((rung) => (rung.certificate ? [rung.certificate] : []))];
  for (const record of records.filter((candidate) => candidate.base === state.base && candidate.head === state.head)) {
    const k2 = data.certificates.find((stored) => stored.file === record.file)?.certificate.checks.find((check) => check.id === 'K2');
    const { changedSpans, editedFiles } = k2?.metrics ?? {};
    if (k2?.status === 'pass' && typeof changedSpans === 'number' && typeof editedFiles === 'number') {
      return `${changedSpans} import specifiers rewritten in ${editedFiles} files (K2 of ${code(record.file)}, base..head)`;
    }
  }
  const sum = (key: 'specifierEdits' | 'filesEdited') => certified.reduce((total, step) => total + (step.counts?.[key] ?? 0), 0);
  return `${sum('specifierEdits')} import-specifier rewrites and ${sum('filesEdited')} file edits summed over ${certified.length} steps (a file several steps edit counts once per step)`;
}

export function prBodyMarkdown(document: FindingsDocument, data: RunData): string {
  const { state } = data;
  const scope = state.packageRoot ? `${state.packageRoot}/` : '.';
  const moduleRoot = [state.packageRoot, state.moduleRoot].filter(Boolean).join('/');
  const certified = state.steps.filter((step) => step.status === 'certified');
  const ofRung = (rung: string) => certified.filter((step) => step.rung === rung);
  const filesMoved = (steps: typeof certified) => steps.reduce((sum, step) => sum + (step.counts?.filesMoved ?? 0), 0);
  const moved = filesMoved([...ofRung('R1'), ...ofRung('R2')]);
  const renamed = filesMoved(ofRung('R3'));
  const platform = ofRung('R2').filter((step) => step.group.startsWith('platform/')).length;
  const shared = ofRung('R2').some((step) => step.group.startsWith('shared/'));
  const boundaries = ofRung('R4').length > 0;
  const plannerPins = data.planText ? readPlanYaml(data.planText).pinned : null;
  const pinReasons = new Map<string, number>();
  for (const pin of plannerPins ?? []) pinReasons.set(pin.reason, (pinReasons.get(pin.reason) ?? 0) + 1);
  const reasonText = [...pinReasons].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([reason, count]) => `${count} ${reason}`).join(', ');
  const pinnedSteps = state.steps.filter((step) => step.status === 'pinned').length;
  const skippedSteps = state.steps.filter((step) => step.status === 'skipped').length;
  const parts = [`${ofRung('R1').length} feature modules`, ...(platform ? [`${platform} platform concerns`] : []), ...(shared ? ['`shared/`'] : [])];

  const lines = [
    `## Restructure ${code(scope)} into feature modules`,
    '',
    `This PR moves ${moved} files of ${code(`${moduleRoot}/`)} into ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}${renamed ? `, then renames ${renamed} files to the house naming` : ''}${boundaries ? ', and adds boundary rules with a frozen baseline' : ''}, in ${certified.length} commits. Only paths and import specifiers change, and every commit carries a certificate that proves it.`,
    '',
    `- **Status:** ${state.status}${state.error ? ` (${cell(state.error.split('\n')[0]!)})` : ''}; ${code(short(state.base))} → ${code(short(state.head))} on ${code(state.branch)}, wall time ${formatDuration(state.timeline.durationMs)}`,
    `- **Steps:** ${state.steps.length} (${['R1', 'R2', 'R3', 'R4'].map((rung) => `${rung} ${state.steps.filter((step) => step.rung === rung).length}`).join(', ')}): ${certified.length} certified, ${pinnedSteps} pinned, ${skippedSteps} skipped`,
    `- **Files:** ${moved} moved${renamed ? `, ${renamed} renamed` : ''}; ${editsText(data, certified)}; nothing else edited`,
    `- **Pins:** ${state.pins.length} files the run left in place after a failure${plannerPins === null ? '' : `; ${plannerPins.length} files the plan never moves${reasonText ? ` (${reasonText})` : ''}`}`,
    '',
    '### Certificates',
    '',
  ];
  const rows = [
    ...state.rungs.flatMap((rung) => (rung.certificate ? certificateRows(`${rung.id} rung (${code(rung.certificate.file)})`, rung.certificate, data) : [])),
    ...(state.certificate ? certificateRows(`**Whole PR** (${code(state.certificate.file)})`, state.certificate, data) : []),
  ];
  if (rows.length) lines.push('| Certificate | Range | Verdict | Checks | Digest |', '|---|---|---|---|---|', ...rows);
  else lines.push('No rung or whole-PR certificate yet.');
  const stepCertificates = certified.filter((step) => step.certificate && step.rung !== 'R4');
  lines.push(
    '',
    `Each of the ${stepCertificates.length} step commits carries its static certificate (every check but the oracles) as trailers: \`Ac-Certificate\`, \`Ac-Certificate-Base-Tree\`, \`Ac-Certificate-Tree\`, \`Ac-Certificate-Digest\`. Rung ends and the whole PR add the target's oracles (K8).`,
    '',
    '### How to verify',
    '',
    '```sh',
    `ac certify <checkout> ${short(state.base)}..${short(state.head)} --profile ${state.profile.name} --oracles`,
    `ac certify <checkout> <commit>~1..<commit> --profile ${state.profile.name}   # one step, static checks`,
    '```',
    '',
    'The certifier reads only the two committed trees and infers the moves itself, so it certifies any diff. The digest leaves out commit SHAs and machine paths: the same trees and checks give the digest in the trailer.',
    '',
    '### Findings: recorded, never fixed',
    '',
  );
  if (!document.findings.length) lines.push('None.', '');
  else {
    lines.push(
      `${document.findings.length} findings. A refactor should make existing problems obvious and leave them alone: these are recorded for follow-up, and this PR fixes none of them. Full log: \`findings/findings.md\` in the run directory.`,
      '',
      ...kindTable(document),
      '',
      ...topList(topFindings(document.findings, topFindingCount)),
    );
  }
  const residual = state.certificate ? data.certificates.find((stored) => stored.file === state.certificate!.file)?.certificate.residualRisk : undefined;
  lines.push('### Residual risk', '', ...(residual?.length ? residual.map((risk) => `- ${risk}`) : ['- No whole-PR certificate yet: see the rung certificates.']), '');
  lines.push('### Plan', '', planLine(state, data.planMarkdown), '');
  if (document.narration) lines.push(`Findings narrated by ${document.narration.label}: ${document.narration.narrated} of ${document.findings.length}, ${money(document.narration.costUsd)}${document.narration.replayed ? ' when recorded, replayed now' : ''}. The evidence under each finding is deterministic.`, '');
  return `${lines.join('\n')}`;
}

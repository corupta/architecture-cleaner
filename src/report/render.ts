// The run report page (plan §4 "Outputs"): one self-contained index.html per run, rendered from RunReportData. Every
// section reads recorded artifacts only; numbers name where they come from, and the run's misses (failed attempts,
// rollbacks, pins, findings) are shown as prominently as its passes.
import { compare } from '../boundaries/folder-graph.js';
import { dagOrder } from '../boundaries/order.js';
import type { CheckId } from '../certificate/types.js';
import type { Finding, NarrationRecord } from '../findings/types.js';
import { models } from '../gateway/models.js';
import { rungIds, type AttemptRecord, type AttemptState, type RungId, type RungStatus, type RunState, type StepRecord } from '../orchestrator/types.js';
import { checkOrder } from './ab.js';
import { flowChart, horizontalBars, legend, matrix, partsBar, stackedColumns, type FlowLink, type FlowNode, type MatrixCell, type Series } from './charts.js';
import { oracleNames, type CertificateView } from './certificates.js';
import { composedPathMap, type FolderKind, type GraphSide, type RunGraph } from './graph.js';
import { code, count, details, escapeHtml, figure, formatDuration, link, page, plural, pre, section, shortSha, statusMark, table, tiles, usd, type Section, type Status } from './html.js';
import { modelLabel } from './ledger.js';
import { renderAbTable, type AbLinks } from './render-ab.js';
import { failedAttemptCounts, failedAttempts, failedAttemptStates, type AttemptView, type PlanSummary, type RunReportData, type StepView, type StoredCertificate } from './run-data.js';

export interface RenderOptions {
  /** Breadcrumb links above the title (the site's), relative to the page. */
  breadcrumbs?: [string, string][];
  /** Links of the A/B section; default: no certificate copies, no run links. */
  abLinks?: AbLinks;
}

const series = {
  certify: { id: 'certify', label: 'certify (static checks)', color: 'var(--s1)' },
  move: { id: 'move', label: 'move and commit', color: 'var(--s2)' },
  other: { id: 'other', label: 'fault, amend, rollback', color: 'var(--s3)' },
  failed: { id: 'failed', label: 'failed attempts (rolled back)', color: 'var(--critical)' },
} satisfies Record<string, Series>;

const kindColor: Record<FolderKind, string> = {
  module: 'var(--s1)', platform: 'var(--s2)', shared: 'var(--s3)', folder: 'var(--neutral)', root: 'var(--neutral)', outside: 'var(--neutral)',
};

const certificateHref = (certificate: StoredCertificate) => certificate.file;

/** Links to the bundle's copies of run-dir files, for the files the run dir has. */
const attachmentLinks = (data: RunReportData, files: [string, string][]) => files.filter(([file]) => data.attachments.includes(file)).map(([file, text]) => link(file, text));

const verdictMark = (view: CertificateView) => statusMark(view.verdict, `${view.verdict.toUpperCase()} (${view.scope === 'full' ? 'static checks and oracles' : 'static checks'})`);

function certificateBlock(certificate: StoredCertificate, summaryPrefix = ''): string {
  return details(`${summaryPrefix}${verdictMark(certificate.view)} <span class="muted small">${escapeHtml(certificate.file)}</span>`,
    `<p class="small">${link(certificateHref(certificate), 'certificate JSON')} · digest ${code(certificate.view.digest)}</p>${pre(certificate.summary)}`);
}

const attemptStatus: Record<AttemptRecord['state'], { status: Status; label: string }> = {
  passed: { status: 'pass', label: 'passed' },
  failed: { status: 'fail', label: 'failed, rolled back' },
  declined: { status: 'skip', label: 'declined by the executor' },
  unverified: { status: 'fail', label: 'unverified, nothing committed' },
  error: { status: 'error', label: 'error, nothing committed' },
  interrupted: { status: 'skip', label: 'interrupted' },
  executing: { status: 'none', label: 'executing' },
  committed: { status: 'none', label: 'committed' },
  certifying: { status: 'none', label: 'certifying' },
};

const stepStatus: Record<StepRecord['status'], { status: Status; label: string }> = {
  certified: { status: 'pass', label: 'certified' },
  pinned: { status: 'skip', label: 'pinned: left in place' },
  skipped: { status: 'skip', label: 'skipped: nothing left to move' },
  pending: { status: 'none', label: 'pending' },
  running: { status: 'none', label: 'running' },
};

const failureWords: Partial<Record<AttemptState, string>> = {
  failed: 'certified FAIL and rolled back',
  declined: 'declined by the executor',
  unverified: 'unverified by the executor',
  error: 'errored',
};

/** "no attempt failed", or how many failed and how: the run report's and the site's run cards' wording. */
export function failedAttemptsPhrase(state: RunState): string {
  const counts = failedAttemptCounts(state);
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  if (!total) return 'no attempt failed';
  const how = counts.map((entry) => `${counts.length > 1 ? `${count(entry.count)} ` : ''}${failureWords[entry.state] ?? entry.state}`).join(', ');
  return `${plural(total, 'attempt')} failed (${how})`;
}

function headerSection(data: RunReportData): { lead: string; body: string } {
  const { state, whole } = data;
  const certified = state.steps.filter((step) => step.status === 'certified');
  const rolledBack = state.steps.flatMap((step) => step.attempts).filter((attempt) => attempt.state === 'failed').length;
  const inFlight = state.steps.flatMap((step) => step.attempts).filter((attempt) => attempt.state === 'executing' || attempt.state === 'committed' || attempt.state === 'certifying').length;
  const moved = composedPathMap(state).size;
  const moveCount = certified.reduce((sum, step) => sum + (step.counts?.filesMoved ?? 0), 0);
  const k2 = whole?.view.checks.find((check) => check.id === 'K2');
  const edits = k2 && typeof k2.metrics.changedSpans === 'number'
    ? { value: count(k2.metrics.changedSpans), note: `in ${count(Number(k2.metrics.editedFiles))} files (whole-PR K2)` }
    : { value: count(certified.reduce((sum, step) => sum + (step.counts?.specifierEdits ?? 0), 0)), note: 'summed over the steps' };
  const scope = state.packageRoot ? `${state.packageRoot}/` : 'the repository root';
  const origin = data.graph?.origin ?? null;
  const baseLink = origin ? link(`${origin}/commit/${state.base}`, shortSha(state.base)) : code(shortSha(state.base));
  const verdict = whole
    ? `<p class="verdict">Whole PR: ${verdictMark(whole.view)}</p>`
    : `<p class="verdict">${statusMark('none', 'no whole-PR certificate')} <span class="small muted">run status ${escapeHtml(state.status)}: the run ended before its whole-PR certificate</span></p>`;
  const lead = `<p class="lead">${escapeHtml(state.profile.name)} ${code(scope)} @ ${baseLink} → ${code(shortSha(state.head))} on ${code(state.branch)}: run status <strong>${escapeHtml(state.status)}</strong>${state.failure ? ` (${escapeHtml(state.failure)})` : ''}.</p>${verdict}`;
  const narration = data.findings?.narration ?? null;
  const planCost = state.cost.planRecordedUsd === null ? 'unknown' : usd(state.cost.planRecordedUsd);
  const tileList = tiles([
    { label: 'Certified commits', value: count(certified.length), note: rungIds.filter((rung) => certified.some((step) => step.rung === rung)).map((rung) => `${rung} ${certified.filter((step) => step.rung === rung).length}`).join(' · ') || 'none' },
    { label: 'Files moved', value: count(moved), note: `${moveCount > moved ? `${count(moveCount - moved)} of them moved again by R3 renames; ` : ''}${plural(state.pins.length, 'file')} pinned` },
    { label: 'Specifier edits', value: edits.value, note: edits.note },
    { label: 'Rolled-back attempts', value: count(rolledBack), note: [rolledBack ? 'each one certified FAIL, then rolled back' : 'no commit failed its certificate', inFlight ? `${plural(inFlight, 'attempt')} still in flight when the run stopped` : ''].filter(Boolean).join('; ') },
    { label: 'Wall time', value: formatDuration(state.timeline.durationMs), note: state.timeline.resumedAt.length ? `resumed ${state.timeline.resumedAt.length}×` : 'one invocation' },
    { label: 'Plan cost when recorded', value: planCost, note: `planner spend in this run ${usd(state.cost.llmUsd)}` },
  ]);
  const facts = table([{ label: 'Field' }, { label: 'Value' }], [
    ['Target', `${escapeHtml(state.profile.name)} (profile), package root ${code(scope)}${origin ? `, ${link(origin, origin.replace(/^https:\/\//, ''))}` : ''}`],
    ['Commits', `base ${baseLink} → head ${code(state.head)}; branch ${code(state.branch)} (a local branch; the certificates name its trees)`],
    ['Trees', `base ${code(state.baseTree)}${whole?.view.headTree ? ` → head ${code(whole.view.headTree)}` : ''}`],
    ['Plan', `${state.plan.source === 'planner' ? 'planned in this run' : `from the plan file ${code(state.plan.source.split('/').pop()!)}`}: ${state.plan.steps} steps, ${state.plan.moves} moves, sha256 ${code(state.plan.sha256)}`],
    ['Rungs requested', escapeHtml(state.rungsRequested.join(', '))],
    ['Whole-PR digest', whole ? code(whole.view.digest) : '–'],
    ['Cost', `planner spend in this run ${usd(state.cost.llmUsd)}${state.cost.budgetRun ? ` (budget run ${code(state.cost.budgetRun)}, mode ${escapeHtml(state.cost.mode ?? '–')})` : ''}; the plan cost ${planCost} when it was recorded${narration ? `; findings narration ${usd(narration.costUsd)} in ${narration.calls} calls (${escapeHtml(narration.label)})${narration.replayed ? ', replayed' : ''}` : ''}`],
    ['Injected fault', state.fault ? `${code(`--inject-fault ${state.fault.step}:${state.fault.operator}`)}: ${state.fault.appliedTo !== undefined ? `applied to step ${state.fault.appliedTo}, ${escapeHtml(state.fault.description ?? '')}` : `not applied${state.fault.notApplied ? `: ${escapeHtml(state.fault.notApplied)}` : ''}`}` : 'none'],
  ]);
  return { lead, body: `${tileList}\n${facts}` };
}

/** `ultra#2` → Nemotron 3 Ultra: a candidate's label names the model alias it was sampled from. */
function candidateModel(label: string): string {
  const alias = label.split('#')[0]!;
  return alias in models ? `NVIDIA ${modelLabel(models[alias as keyof typeof models].id)}` : alias;
}

/** Who made the plan, from plan.json: the seeds draft, the model's edited candidates, the critic; or plan.yaml's sources alone. */
export function planMaking(plan: PlanSummary): string {
  if (plan.editors === null) {
    const changed = ['planner', 'critic'].filter((source) => plan.bySource[source]).map((source, index) => `${count(plan.bySource[source]!)}${index ? '' : ` ${plan.bySource[source] === 1 ? 'placement' : 'placements'}`} by the ${source}`);
    return `Deterministic seeds decided where files go${changed.length ? `; plan.yaml marks ${changed.join(' and ')}` : ''}. This run dir has no plan.json, so the report can't name the models that made the plan.`;
  }
  if (!plan.editors.length) {
    const edited = plan.bySource.planner ? 'the planner edited the draft (plan.json names no edited candidate)' : 'no model edited the draft';
    return `Deterministic seeds decided where files go, and ${edited}${plan.critic ? '; a critic call reviewed it' : ''}.`;
  }
  const editors = [...new Set(plan.editors.map(candidateModel))].join(' and ');
  return `Deterministic seeds decided where files go; ${editors} (on Nebius Token Factory) edited the draft in ${plural(plan.editors.length, 'candidate')}${plan.critic ? ', and a critic call reviewed the chosen one' : ''}; the validator gates ${plan.critic ? 'both' : 'the edits'}.`;
}

/** What the gate made of the critic's review, next to the review itself: the review is the model's claim, this is the record. */
function criticOutcome(plan: PlanSummary, findings: RunReportData['findings']): string {
  if (!plan.criticSuggestions) return '';
  const warnings = findings?.findings.filter((finding) => finding.kind === 'plan-warning').length;
  return `<p class="small">The gate accepted ${count(plan.criticSuggestions.accepted)} of the critic's ${plural(plan.criticSuggestions.total, 'suggestion')}${warnings !== undefined ? `; ${plural(warnings, 'validator warning')} ${warnings === 1 ? 'remains' : 'remain'} on the plan (findings: plan-warning)` : ''}.</p>`;
}

function planSection(data: RunReportData): Section {
  const plan = data.plan;
  if (!plan) return { id: 'plan', title: 'The plan', body: '<p>The run dir has no plan.yaml.</p>' };
  const sourceOrder = ['draft', 'planner', 'critic', 'human'];
  const decided = Object.entries(plan.bySource).sort(([left], [right]) => sourceOrder.indexOf(left) - sourceOrder.indexOf(right) || compare(left, right)).map(([source, value]) => `${count(value)} ${source === 'draft' ? 'from the deterministic seeds draft' : `by the ${source}`}`).join(', ');
  const decisions = plan.decisions.length
    ? table([{ label: 'File' }, { label: 'Group' }, { label: 'Decided by' }, { label: 'Rationale' }],
      plan.decisions.map((decision) => [code(decision.path), code(decision.group), escapeHtml(decision.source), decision.rationale ? escapeHtml(decision.rationale) : '<span class="muted">none given</span>']))
    : '<p>Every placement came from the deterministic draft.</p>';
  return {
    id: 'plan',
    title: 'The plan: Nemotron draws the map',
    body: `<p>${escapeHtml(planMaking(plan))} The plan has ${plan.groups.module} modules, ${plan.groups.platform} platform folders and ${plan.groups.shared} shared folder over ${count(plan.files)} planned files: ${escapeHtml(decided)}. ${count(plan.contested)} placements are marked contested.${plan.winner ? ` The chosen candidate is ${code(plan.winner)}.` : ''}</p>
${plan.criticReview ? `<p><strong>The critic's review</strong> (plan.json, the model's own words): ${escapeHtml(plan.criticReview)}</p>${criticOutcome(plan, data.findings)}` : ''}
${details(`Placements the planner and the critic decided (${plan.decisions.length})`, decisions, { className: 'more' })}
<p class="small">${[...attachmentLinks(data, [['plan/plan.yaml', 'plan.yaml'], ['plan/plan.md', 'plan.md']]), ...(plan.recordedCostUsd !== null ? [`the plan cost ${usd(plan.recordedCostUsd)} when it was recorded; a replay from the cassette costs $0`] : [])].join(' · ')}</p>`,
  };
}

function flowFigure(graph: RunGraph): string {
  const leftTotals = new Map<string, number>();
  const rightTotals = new Map<string, number>();
  for (const edge of graph.flow) {
    leftTotals.set(edge.from, (leftTotals.get(edge.from) ?? 0) + edge.files);
    rightTotals.set(edge.to, (rightTotals.get(edge.to) ?? 0) + edge.files);
  }
  const kindOf = new Map<string, FolderKind>([...graph.base.folders, ...graph.head.folders].map((folder) => [folder.key, folder.kind]));
  const leftKeys = [...leftTotals.keys()].sort((a, b) => leftTotals.get(b)! - leftTotals.get(a)! || compare(a, b));
  const leftPosition = new Map(leftKeys.map((key, index) => [key, index]));
  const kindRank: FolderKind[] = ['module', 'platform', 'shared', 'folder', 'root', 'outside'];
  const barycenter = (key: string) => {
    const incoming = graph.flow.filter((edge) => edge.to === key);
    return incoming.reduce((sum, edge) => sum + leftPosition.get(edge.from)! * edge.files, 0) / Math.max(1, rightTotals.get(key)!);
  };
  const rightKeys = [...rightTotals.keys()].sort((a, b) => kindRank.indexOf(kindOf.get(a) ?? 'folder') - kindRank.indexOf(kindOf.get(b) ?? 'folder') || barycenter(a) - barycenter(b) || compare(a, b));
  const leftNodes: FlowNode[] = leftKeys.map((key) => ({ key: `from:${key}`, label: key, value: leftTotals.get(key)!, color: 'var(--neutral)', tip: `${key} at base: ${leftTotals.get(key)} files` }));
  const rightNodes: FlowNode[] = rightKeys.map((key) => ({ key: `to:${key}`, label: key, value: rightTotals.get(key)!, color: kindColor[kindOf.get(key) ?? 'folder'], tip: `${key} at head: ${rightTotals.get(key)} files from base` }));
  const links: FlowLink[] = graph.flow.map((edge) => ({
    from: `from:${edge.from}`, to: `to:${edge.to}`, value: edge.files, color: kindColor[kindOf.get(edge.to) ?? 'folder'],
    tip: `${edge.from} → ${edge.to}: ${plural(edge.files, 'file')}${edge.from === edge.to ? ' (stayed)' : ''}`,
  }));
  const kinds: Series[] = [
    { id: 'module', label: 'module/', color: kindColor.module },
    { id: 'platform', label: 'platform/', color: kindColor.platform },
    { id: 'shared', label: 'shared/', color: kindColor.shared },
    { id: 'stayed', label: 'left where it was (not in the layout)', color: kindColor.folder },
  ];
  const tableView = table([{ label: 'Base folder' }, { label: 'Head folder' }, { label: 'Files', numeric: true }],
    graph.flow.map((edge) => [code(edge.from), code(edge.to), count(edge.files)]));
  const total = [...leftTotals.values()].reduce((sum, value) => sum + value, 0);
  return figure(`Files flow: where the ${count(total)} source files under ${graph.moduleRoot || 'the package'}/ went`,
    `${legend(kinds)}${flowChart(leftNodes, rightNodes, links, { unit: 1.1, minimum: 11 })}`,
    { caption: 'Left: the folders at the base commit, by size. Right: where their files are at the head commit, grouped by layout kind. A band is a number of files; every node is at least one label tall, so small groups are drawn larger than their share.', tableView });
}

function matrixFigure(title: string, side: GraphSide, cell: number, caption: string): string {
  const keys = side.folders.map((folder) => folder.key);
  const order = dagOrder(keys, side.edges.map((edge) => ({ from: edge.from, to: edge.to, weight: edge.pairs })));
  const position = new Map(order.map((key, index) => [key, index]));
  const nodes = order.map((key) => ({ key, label: key }));
  const cells: MatrixCell[] = side.edges.map((edge) => {
    const against = position.get(edge.from)! > position.get(edge.to)!;
    return {
      row: edge.from, column: edge.to, value: edge.pairs, color: against ? 'var(--s2)' : 'var(--s1)',
      tip: `${edge.from} imports ${edge.to}\n${plural(edge.pairs, 'file pair')}${edge.typeOnlyPairs ? ` (${edge.typeOnlyPairs} type-only)` : ''}${against ? '\nagainst the order: closes a cycle' : ''}`,
    };
  });
  for (const folder of side.folders) {
    if (folder.internalPairs) cells.push({ row: folder.key, column: folder.key, value: folder.internalPairs, color: 'var(--s3)', tip: `${folder.key}: ${plural(folder.internalPairs, 'file pair')} inside the folder\n${plural(folder.files, 'file')} (${folder.productionFiles} production)` });
  }
  const keyLegend = legend([
    { id: 'forward', label: 'imports along the order', color: 'var(--s1)' },
    { id: 'against', label: 'imports against the order (they close cycles)', color: 'var(--s2)' },
    { id: 'inside', label: 'imports inside one folder (diagonal)', color: 'var(--s3)' },
  ]);
  const tableView = table([{ label: 'Importer folder' }, { label: 'Imported folder' }, { label: 'File pairs', numeric: true }, { label: 'Type-only', numeric: true }],
    side.edges.map((edge) => [code(edge.from), code(edge.to), count(edge.pairs), count(edge.typeOnlyPairs)]));
  return figure(title, `${keyLegend}${matrix(nodes, nodes, cells, { cell, labelWidth: 160 })}`, {
    caption: `${caption} Rows import columns. Folders are ordered importers first (strongly connected sets, then a greedy order inside each), so a cell below the diagonal is an import against the order. Darker means more file pairs (1, 2–3, 4–9, 10–29, 30+).`,
    tableView,
  });
}

const pairShare = (side: GraphSide) => side.internalPairs / Math.max(1, side.internalPairs + side.crossPairs);
const percent = (share: number) => `${(100 * share).toFixed(1)}%`;

/** What the graph prose says about the run beyond the graph itself, read from run.json and the findings log. */
export interface NarrativeFacts {
  /** R4's rung status in run.json (null when the run has no R4 record): its rules freeze the violations only once certified. */
  r4: RungStatus | null;
  /** Findings that name what ties the modules together. */
  godInjections: number;
  moduleCycles: number;
}

export function narrativeFacts(data: RunReportData): NarrativeFacts {
  const kinds = data.findings?.findings.map((finding) => finding.kind) ?? data.state.findings.map((finding) => finding.kind);
  return {
    r4: data.state.rungs.find((rung) => rung.id === 'R4')?.status ?? null,
    godInjections: kinds.filter((kind) => kind === 'god-injection').length,
    moduleCycles: kinds.filter((kind) => kind === 'module-cycle').length,
  };
}

const layoutKinds: { kind: FolderKind; describe: (folders: number) => string }[] = [
  { kind: 'module', describe: (folders) => plural(folders, 'feature module') },
  { kind: 'platform', describe: (folders) => plural(folders, 'platform folder') },
  { kind: 'shared', describe: () => 'shared/' },
];

/**
 * Where the base's source files sit on one side, by layout kind, from graph.json's flow: "sit in 14 folders outside the
 * layout", "18 sit in 3 feature modules and 545 are still in 14 folders outside the layout", "all sit in the layout: ...".
 */
export function whereFilesSit(graph: RunGraph, side: 'base' | 'head'): string {
  const kindOf = new Map(graph[side].folders.map((folder) => [folder.key, folder.kind]));
  const files = new Map<string, number>();
  for (const edge of graph.flow) {
    const key = side === 'base' ? edge.from : edge.to;
    files.set(key, (files.get(key) ?? 0) + edge.files);
  }
  const inKinds = (kinds: FolderKind[]) => {
    const keys = [...files.keys()].filter((key) => kinds.includes(kindOf.get(key) ?? 'folder'));
    return { folders: keys.length, files: keys.reduce((sum, key) => sum + files.get(key)!, 0) };
  };
  const others = inKinds(['folder', 'root', 'outside']);
  const outside = `${plural(others.folders, 'folder')} outside the layout`;
  const inLayout = layoutKinds.map(({ kind, describe }) => ({ ...inKinds([kind]), describe })).filter((part) => part.files);
  if (!inLayout.length) return `sit in ${outside}`;
  const parts = inLayout.map((part) => `${count(part.files)} in ${part.describe(part.folders)}`);
  const listed = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  if (!others.files) return `all sit in the layout: ${listed}`;
  const placed = inLayout.length === 1
    ? `${count(inLayout[0]!.files)} sit in ${inLayout[0]!.describe(inLayout[0]!.folders)}`
    : `${count(inLayout.reduce((sum, part) => sum + part.files, 0))} sit in the layout (${listed})`;
  return `${placed} and ${count(others.files)} are still in ${outside}`;
}

/** What R4's state means for today's violations. */
function boundaryRulesClause(r4: RungStatus | null): string {
  if (r4 === 'certified') return "R4's rules freeze today's violations so they can't grow.";
  const why = r4 === null || r4 === 'not-requested' ? 'R4 was not part of this run' : `R4 ended ${r4}`;
  return `${why}, so no boundary rules hold them yet.`;
}

/** The graph section's prose, worded from the numbers (a rise, a fall, totals that match or not) and the run's state. */
export function graphNarrative(graph: RunGraph, facts: NarrativeFacts): string {
  const { base, head } = graph;
  const total = (side: GraphSide) => side.internalPairs + side.crossPairs;
  const share = (side: GraphSide) => `${count(side.internalPairs)} of ${count(total(side))} (${percent(pairShare(side))})`;
  const topInternal = (side: GraphSide) => [...side.folders].sort((a, b) => b.internalPairs - a.internalPairs || compare(a.key, b.key)).slice(0, 3).filter((folder) => folder.internalPairs)
    .map((folder) => `${folder.key} ${folder.internalPairs}`).join(', ') || 'none';
  const files = graph.flow.reduce((sum, edge) => sum + edge.files, 0);
  const layout = `At the base commit the ${plural(files, 'source file')} under ${graph.moduleRoot || 'the package'}/ ${whereFilesSit(graph, 'base')}; at the head commit ${whereFilesSit(graph, 'head')}.`;
  const totals = total(base) === total(head)
    ? `The file-level import pairs are the same ${count(total(base))} on both sides (a certified move keeps every import resolving to the same file); only their grouping changes.`
    : `There are ${count(total(base))} file-level import pairs at base and ${count(total(head))} at head: the head tree adds or drops importers under the module root.`;
  const delta = pairShare(head) - pairShare(base);
  const direction = Math.abs(delta) < 0.0005 ? 'stays the same' : delta > 0 ? 'rises' : 'falls';
  const ties = [facts.godInjections && plural(facts.godInjections, 'god-injection base class', 'god-injection base classes'), facts.moduleCycles && plural(facts.moduleCycles, 'module cycle')].filter(Boolean);
  const reading = delta > 0.0005
    ? 'More of the imports now stay inside one folder.'
    : `Grouping by feature doesn't remove the imports between features; it makes them visible.${ties.length ? ` The findings below name what ties the modules together (${ties.join(' and ')}).` : ''} ${boundaryRulesClause(facts.r4)}`;
  return `${layout} ${totals} The share of pairs inside one folder ${direction}: ${share(base)} at base, ${share(head)} at head. The largest blocks of internal pairs are ${topInternal(base)} at base and ${topInternal(head)} at head. ${reading}`;
}

function graphSection(data: RunReportData): Section {
  const graph = data.graph;
  if (!graph) {
    return { id: 'graph', title: 'Before and after: the module graph', body: `<p>No graph.json in the run dir. It is derived from the repo once: run ${code(`ac report ${data.name} --repo <a clone with the run's commits>`)}; afterwards the report builds offline.</p>` };
  }
  const { base, head } = graph;
  const kinds = (side: GraphSide) => {
    const byKind = (kind: FolderKind) => side.folders.filter((folder) => folder.kind === kind).length;
    const others = byKind('folder') + byKind('root') + byKind('outside');
    return [byKind('module') && `${byKind('module')} modules`, byKind('platform') && `${byKind('platform')} platform`, byKind('shared') && 'shared', others && `${others} other folders`].filter(Boolean).join(', ');
  };
  const largest = (side: GraphSide) => side.cycles[0]?.length ?? 0;
  const moved = graph.flow.filter((edge) => edge.from !== edge.to).reduce((sum, edge) => sum + edge.files, 0);
  const total = graph.flow.reduce((sum, edge) => sum + edge.files, 0);
  const cycleList = (side: GraphSide, label: string) => side.cycles.length
    ? details(`${label}: ${side.cycles.map((cycle) => `${cycle.length} folders`).join(', ')}`, side.cycles.map((cycle) => `<p class="small">${cycle.map((key) => code(key)).join(' ')}</p>`).join(''), { className: 'more' })
    : `<p class="small">${escapeHtml(label)}: none.</p>`;
  const body = `${tiles([
    { label: 'Folders', value: `${base.folders.length} → ${head.folders.length}`, note: `head: ${kinds(head)}` },
    { label: 'Files that changed folder', value: `${count(moved)} of ${count(total)}`, note: 'source files under the module root, tests included' },
    { label: 'Import pairs inside one folder', value: `${percent(pairShare(base))} → ${percent(pairShare(head))}`, note: `${count(base.internalPairs)} → ${count(head.internalPairs)} file pairs` },
    { label: 'Largest import cycle', value: `${largest(base)} of ${base.folders.length} → ${largest(head)} of ${head.folders.length}`, note: 'strongly connected folders, the composition root left out' },
  ])}
<p>${escapeHtml(graphNarrative(graph, narrativeFacts(data)))}</p>
${cycleList(base, 'Import cycles at base')}
${cycleList(head, 'Import cycles at head')}
${flowFigure(graph)}
${matrixFigure(`Before: ${base.folders.length} folders at ${shortSha(base.commit)}`, base, 22, `${count(base.crossPairs)} file pairs cross folders in ${count(base.edges.length)} folder edges.`)}
${matrixFigure(`After: ${head.folders.length} folders at ${shortSha(head.commit)}`, head, 10, `${count(head.crossPairs)} file pairs cross folders in ${count(head.edges.length)} folder edges.`)}
<p class="small muted">Computed by ${escapeHtml(graph.source.analyzer)} with TypeScript ${escapeHtml(graph.source.typescript)}, from git objects of both commits; stored in graph.json. Folders outside the layout are collapsed to their first directory under the module root, so this graph can count fewer folders than ${data.attachments.includes('boundaries/report.json') ? "R4's report and " : ''}the findings log.${graph.unmatched.length ? ` ${plural(graph.unmatched.length, 'file')} of the step maps were not found at head: ${graph.unmatched.slice(0, 5).map((file) => code(file)).join(', ')}.` : ''}</p>`;
  return { id: 'graph', title: 'Before and after: the module graph', body };
}

function attemptBlock(view: AttemptView): string {
  const { attempt, certificate } = view;
  const status = attemptStatus[attempt.state];
  const lines = [
    `<p>${statusMark(status.status, `attempt ${attempt.attempt}: ${status.label}`)} <span class="small muted">round ${attempt.round}, from ${code(shortSha(attempt.parent))}, ${plural(attempt.moves, 'move')}, ${formatDuration(attempt.durationMs)}</span></p>`,
  ];
  if (attempt.injectedFault) lines.push(`<p class="small"><span class="pill pill-warn">injected fault</span> ${code(attempt.injectedFault.operator)} ${escapeHtml(attempt.injectedFault.description)}</p>`);
  if (attempt.detail) lines.push(`<p class="small">${escapeHtml(attempt.detail)}</p>`);
  if (attempt.offending.length) lines.push(`<p class="small">Offending: ${attempt.offending.map((file) => code(file)).join(', ')}</p>`);
  if (attempt.pinned.length) lines.push(`<p class="small">Pinned by this failure: ${attempt.pinned.map((file) => code(file)).join(', ')}</p>`);
  if (certificate) lines.push(certificateBlock(certificate, attempt.state === 'passed' ? 'Certificate: ' : 'Certificate of the rolled-back commit: '));
  return lines.join('\n');
}

function stepBlock(view: StepView): string {
  const { step } = view;
  const status = stepStatus[step.status];
  const failed = failedAttempts(step);
  const counts = step.counts ? `${plural(step.counts.filesMoved, 'file')} moved, ${plural(step.counts.specifierEdits, 'specifier edit')} in ${plural(step.counts.filesEdited, 'file')}` : step.rung === 'R4' ? 'boundary rules added' : 'nothing committed';
  const summary = `<span class="mono">${String(step.index).padStart(3, '0')}</span> ${escapeHtml(step.rung)} ${code(step.group)} ${statusMark(status.status, status.label)}${failed.length ? ` <span class="pill pill-warn">${failed.length} failed attempt${failed.length === 1 ? '' : 's'}</span>` : ''} <span class="small muted">${escapeHtml(counts)}, ${formatDuration(step.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0))}</span>`;
  const moves = Object.entries(step.pathMap ?? step.moves);
  const moveList = moves.length ? details(`${moves.length} path${moves.length === 1 ? '' : 's'} ${step.pathMap ? 'moved' : 'requested'}`, pre(moves.map(([from, to]) => `${from}\n  → ${to}`).join('\n')), { className: 'more' }) : '';
  const commit = step.commit ? `<p class="small">Commit ${code(step.commit)}${step.tree ? `, tree ${code(step.tree)}` : ''}</p>` : '';
  return details(summary, `<div class="step">${commit}${moveList}${view.attempts.map(attemptBlock).join('\n')}</div>`, { className: 'step-block' });
}

function timingFigure(data: RunReportData): string {
  const ran = data.steps.filter((view) => view.step.attempts.length);
  if (!ran.length) return '';
  const columns = ran.map(({ step }) => {
    const passing = step.attempts.filter((attempt) => attempt.state === 'passed');
    const sum = (attempts: AttemptRecord[], key: keyof AttemptRecord['timings']) => attempts.reduce((total, attempt) => total + (attempt.timings[key] ?? 0), 0) / 1000;
    const failedSeconds = failedAttempts(step).reduce((total, attempt) => total + attempt.durationMs, 0) / 1000;
    const values = {
      certify: sum(passing, 'certifyMs'),
      move: sum(passing, 'moveMs') + sum(passing, 'commitMs'),
      other: sum(passing, 'faultMs') + sum(passing, 'amendMs') + sum(passing, 'rollbackMs'),
      failed: failedSeconds,
    };
    const tip = `step ${step.index} ${step.group} (${step.rung})\ncertify ${values.certify.toFixed(1)} s, move and commit ${values.move.toFixed(1)} s${values.other ? `, other ${values.other.toFixed(1)} s` : ''}${failedSeconds ? `\nfailed attempts ${failedSeconds.toFixed(1)} s` : ''}`;
    return { label: String(step.index), values, tip, band: step.rung };
  });
  const used = Object.values(series).filter((entry) => columns.some((column) => (column.values as Record<string, number>)[entry.id]! > 0));
  const tableView = table([{ label: '#', numeric: true }, { label: 'Rung' }, { label: 'Group' }, { label: 'Move + commit (s)', numeric: true }, { label: 'Certify (s)', numeric: true }, { label: 'Other (s)', numeric: true }, { label: 'Failed attempts (s)', numeric: true }],
    ran.map(({ step }, index) => {
      const values = columns[index]!.values;
      return [String(step.index), escapeHtml(step.rung), code(step.group), values.move.toFixed(1), values.certify.toFixed(1), values.other.toFixed(1), values.failed.toFixed(1)];
    }));
  return figure('Time per step', stackedColumns(columns, used, { unit: 's', labelEvery: 5 }), {
    caption: `Seconds per step, from run.json attempt timings.${ran.some(({ step }) => step.rung === 'R4') ? ' R4 has no static step certificate: its time is its rung certificate (with oracles).' : ''}`,
    tableView,
  });
}

function wallTimeFigure(data: RunReportData): string {
  const { timeline } = data.state;
  const parts = [
    { id: 'preflight', label: 'preflight', value: timeline.preflightMs, color: 'var(--neutral)' },
    { id: 'baseline', label: 'baseline test runs', value: timeline.baselineMs, color: 'var(--s3)' },
    { id: 'steps', label: 'steps (move, commit, certify)', value: timeline.stepsMs, color: 'var(--s1)' },
    { id: 'rungs', label: 'rung certificates with oracles', value: timeline.rungCertificationMs, color: 'var(--s2)' },
    { id: 'bisect', label: 'K8 bisect', value: timeline.bisectMs, color: 'var(--critical)' },
    { id: 'whole', label: 'whole-PR certificate', value: timeline.runCertificationMs, color: 'var(--ink-2)' },
  ].filter((part) => part.value > 0);
  const accounted = parts.reduce((sum, part) => sum + part.value, 0);
  const segments = parts.map((part) => ({ series: { id: part.id, label: part.label, color: part.color }, value: part.value, tip: `${part.label}: ${formatDuration(part.value)}` }));
  const tableView = table([{ label: 'Phase' }, { label: 'Time', numeric: true }], [...parts.map((part) => [escapeHtml(part.label), formatDuration(part.value)]), ['other (findings, report, bookkeeping)', formatDuration(Math.max(0, timeline.durationMs - accounted))], ['<strong>wall time</strong>', `<strong>${formatDuration(timeline.durationMs)}</strong>`]]);
  return figure(`Wall time: ${formatDuration(timeline.durationMs)}`, partsBar(segments, { format: formatDuration }), { tableView });
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What the failed attempts' kinds left behind: a FAIL is rolled back, the executor's refusals commit nothing. */
function failureMechanics(states: AttemptState[]): string {
  const uncommitted = (['declined', 'unverified', 'error'] as const).filter((state) => states.includes(state)).map((state) => failureWords[state]!.replace(' by the executor', ''));
  return [
    states.includes('failed') ? 'A commit that fails its certificate is rolled back.' : '',
    uncommitted.length ? `An attempt ${uncommitted.join(' or ')} commits nothing.` : '',
  ].filter(Boolean).join(' ');
}

/** What happened to a failed attempt's step next: the replan and the next attempt's outcome, from run.json. */
function afterFailure(step: StepRecord, attempt: AttemptRecord): string {
  const next = step.attempts.find((candidate) => candidate.attempt === attempt.attempt + 1);
  if (!next) return '';
  return `<p class="small">The step then replanned${attempt.pinned.length ? ` without ${plural(attempt.pinned.length, 'pinned file')}` : ''}: attempt ${next.attempt} ${escapeHtml(attemptStatus[next.state].label)}.</p>`;
}

/** The ladder's line when no attempt failed, qualified by what the steps did: certified, resumed, pinned. */
export function noFailureSentence(state: RunState): string {
  const certified = state.steps.filter((step) => step.status === 'certified');
  const resumed = certified.filter((step) => step.attempts.some((attempt) => attempt.state === 'interrupted')).length;
  const pinned = state.steps.filter((step) => step.status === 'pinned').length;
  const passed = !certified.length
    ? 'no step was certified'
    : `${certified.length === 1 ? 'the one certified step' : `each of the ${count(certified.length)} certified steps`} passed its certificate on its first attempt${resumed ? ` (${plural(resumed, 'step')} after an interrupted attempt that --resume discarded)` : ''}`;
  return `No attempt failed: ${passed}.${pinned ? ` ${plural(pinned, 'step was', 'steps were')} pinned and left in place.` : ''}`;
}

/** Which of the run's commits are certified how, from the stored certificates (the ladder's opening and the site's run cards). */
export interface CertificateCoverage {
  /** Certified steps by their certificate's scope. */
  staticSteps: StepRecord[];
  fullSteps: StepRecord[];
  /** Certified steps without a certificate file in the run dir. */
  unstoredSteps: number;
  /** The checks the static step certificates ran, in check order. */
  staticChecks: CheckId[];
  /** Rung certificates by scope; partial when the run stopped inside the rung. */
  fullRungs: { id: RungId; partial: boolean }[];
  staticRungs: RungId[];
  whole: 'full' | 'static' | null;
  /** The oracles K8 ran in the certificates with oracles. */
  oracles: string[];
}

export function certificateCoverage(data: RunReportData): CertificateCoverage {
  const stepCertificates = data.steps.flatMap((view) => {
    const file = view.step.certificate?.file;
    const certificate = view.attempts.find((attempt) => attempt.certificate && attempt.certificate.file === file)?.certificate;
    return view.step.status === 'certified' && certificate ? [{ step: view.step, certificate }] : [];
  });
  const staticSteps = stepCertificates.filter(({ certificate }) => certificate.view.scope === 'static');
  const rungs = data.rungs.filter((view) => view.certificate);
  const fullRungs = rungs.filter((view) => view.certificate!.view.scope === 'full');
  const withOracles = [...fullRungs.map((view) => view.certificate!), ...(data.whole?.view.scope === 'full' ? [data.whole] : [])];
  return {
    staticSteps: staticSteps.map(({ step }) => step),
    fullSteps: stepCertificates.filter(({ certificate }) => certificate.view.scope === 'full').map(({ step }) => step),
    unstoredSteps: data.state.steps.filter((step) => step.status === 'certified').length - stepCertificates.length,
    staticChecks: checkOrder.filter((id) => staticSteps.some(({ certificate }) => certificate.view.checks.some((check) => check.id === id))),
    fullRungs: fullRungs.map((view) => ({ id: view.rung.id, partial: Boolean(view.rung.certificate?.partial) })),
    staticRungs: rungs.filter((view) => view.certificate!.view.scope === 'static').map((view) => view.rung.id),
    whole: data.whole?.view.scope ?? null,
    oracles: [...new Set(withOracles.flatMap((certificate) => oracleNames(certificate.view)))],
  };
}

/** The ladder's opening, from the run's certificates: which commits had the static checks, which the oracles, what is missing. */
export function ladderIntro(data: RunReportData): string {
  const { state } = data;
  const coverage = certificateCoverage(data);
  const sentences: string[] = [];
  if (coverage.staticSteps.length) {
    const checks = coverage.staticChecks.join(', ');
    const order = state.options.jobs > 1
      ? `with the static checks (${checks}); with --jobs ${state.options.jobs}, later steps executed ahead of the certificates, and a FAIL discards them`
      : `before the next one started, with the static checks (${checks})`;
    sentences.push(`One transformation per commit: ${coverage.staticSteps.length === 1 ? 'the one committed step was' : `each of the ${count(coverage.staticSteps.length)} committed steps was`} certified against its parent ${order}.`);
  }
  for (const step of coverage.fullSteps) {
    const rung = state.rungs.find((candidate) => candidate.id === step.rung);
    sentences.push(`Step ${step.index} (${step.rung}) is certified with the oracles${rung?.certificate?.file === step.certificate?.file ? ', by its rung certificate' : ''}.`);
  }
  if (coverage.unstoredSteps) sentences.push(`${plural(coverage.unstoredSteps, 'certified step has', 'certified steps have')} no certificate file in the run dir.`);
  const rungNames = coverage.fullRungs.map((rung) => `${rung.id}${rung.partial ? ' (partial: the run stopped inside the rung)' : ''}`);
  const withOracles = [rungNames.length ? `the rung ${rungNames.length === 1 ? 'certificate' : 'certificates'} of ${rungNames.join(', ')}` : '', coverage.whole === 'full' ? 'the whole-PR certificate' : ''].filter(Boolean);
  if (withOracles.length) {
    const many = rungNames.length + Number(coverage.whole === 'full') > 1;
    sentences.push(`${capitalize(withOracles.join(' and '))} ${many ? 'add' : 'adds'} the oracles (K8: ${coverage.oracles.join(', ') || 'none named'}).`);
  }
  if (coverage.staticRungs.length) sentences.push(`The rung ${coverage.staticRungs.length === 1 ? 'certificate' : 'certificates'} of ${coverage.staticRungs.join(', ')} ${coverage.staticRungs.length === 1 ? 'has' : 'have'} the static checks only.`);
  if (coverage.whole === 'static') sentences.push('The whole-PR certificate has the static checks only.');
  if (!coverage.whole) sentences.push(`There is no whole-PR certificate (run status: ${state.status}).`);
  sentences.push('A FAIL rolls the commit back, and the step replans with the plan entries the failure names pinned in place.');
  return sentences.join(' ');
}

function ladderSection(data: RunReportData): Section {
  const { state } = data;
  const rungRows = data.rungs.map(({ rung, certificate }) => {
    const steps = state.steps.filter((step) => step.rung === rung.id);
    const by = (status: StepRecord['status']) => steps.filter((step) => step.status === status).length;
    const stepCell = rung.id === 'R0' ? '–' : `${by('certified')} certified${by('pinned') ? `, ${by('pinned')} pinned` : ''}${by('skipped') ? `, ${by('skipped')} skipped` : ''}${by('pending') ? `, ${by('pending')} pending` : ''}`;
    const verdict = certificate ? `${verdictMark(certificate.view)}${rung.certificate?.partial ? ' <span class="pill">partial</span>' : ''}` : rung.note ? `<span class="small">${escapeHtml(rung.note)}</span>` : '–';
    const bisect = rung.bisect ? `<br><span class="small">K8 bisect: ${rung.bisect.firstFailingStep !== null ? `step ${rung.bisect.firstFailingStep} pinned` : 'stopped without evidence'}, ${rung.bisect.probes.length} probes</span>` : '';
    return [`<strong>${escapeHtml(rung.id)}</strong>`, escapeHtml(rung.status), stepCell, verdict + bisect, formatDuration(rung.durationMs)];
  });
  const failures = data.steps.flatMap((view) => view.attempts.filter(({ attempt }) => failedAttemptStates.has(attempt.state)).map((attempt) => ({ view, attempt })));
  const failureBlock = failures.length
    ? `<h3>Failed attempts and rollbacks (${failures.length})</h3>
<p>${escapeHtml(capitalize(failedAttemptsPhrase(state)))}. ${escapeHtml(failureMechanics(failures.map(({ attempt }) => attempt.attempt.state)))} They are recorded here and in run.json, never hidden.</p>
${failures.map(({ view, attempt }) => `<div class="finding"><h4>Step ${view.step.index} ${code(view.step.group)}, attempt ${attempt.attempt.attempt} of ${view.step.attempts.length}; the step ended ${statusMark(stepStatus[view.step.status].status, stepStatus[view.step.status].label)}</h4>${attemptBlock(attempt)}${afterFailure(view.step, attempt.attempt)}</div>`).join('\n')}`
    : `<p>${escapeHtml(noFailureSentence(state))}</p>`;
  const neverRan = data.steps.filter((view) => !view.step.attempts.length && view.step.status === 'pending').length;
  const rungCertificates = data.rungs.filter((view) => view.certificate).map((view) => certificateBlock(view.certificate!, `${view.rung.id} rung certificate: `)).join('\n');
  const probes = data.rungs.flatMap((view) => view.probes.map((probe) => certificateBlock(probe, `${view.rung.id} bisect probe: `))).join('\n');
  const others = data.otherCertificates.length
    ? `<h3>Other stored certificates</h3><p class="small">Certificates in the run dir that run.json no longer points to (a rung certificate a bisect superseded, a FAIL kept under a -2 name).</p>${data.otherCertificates.map((certificate) => certificateBlock(certificate)).join('\n')}`
    : '';
  const body = `<p>${escapeHtml(ladderIntro(data))}</p>
${table([{ label: 'Rung' }, { label: 'Status' }, { label: 'Steps' }, { label: 'Rung certificate' }, { label: 'Duration', numeric: true }], rungRows)}
${wallTimeFigure(data)}
${failureBlock}
<h3>Every step</h3>
<p class="small">Open a step for its moves, its attempts and its certificate.</p>
${data.steps.filter((view) => view.step.attempts.length || view.step.status !== 'pending').map(stepBlock).join('\n')}
${neverRan ? `<p class="small muted">${plural(neverRan, 'step')} never ran (run status: ${escapeHtml(state.status)}).</p>` : ''}
${timingFigure(data)}
<h3>Rung certificates</h3>
${rungCertificates || '<p>None.</p>'}
${probes}
<h3>The whole PR</h3>
${data.whole ? certificateBlock(data.whole, 'Whole-PR certificate: ') : '<p>No whole-PR certificate.</p>'}
${others}`;
  return { id: 'ladder', title: 'The ladder', body };
}

/** The structural findings lead (what the new layout makes obvious), then the rest by count. */
const leadingKinds = ['module-cycle', 'god-injection', 'multi-writer-table', 'back-edge', 'injected-fault', 'pinned'];

function findingBlock(finding: Finding, narratorLabel: string | null): string {
  const files = finding.files.length ? `<p class="small">Files: ${finding.files.slice(0, 8).map((file) => code(file)).join(' ')}${finding.files.length > 8 ? ` and ${finding.files.length - 8} more` : ''}</p>` : '';
  const where = [finding.steps.length ? `steps ${finding.steps.join(', ')}` : '', finding.certificates.length ? `certificates ${finding.certificates.join(', ')}` : ''].filter(Boolean).join('; ');
  return `<div class="finding"><h4>${escapeHtml(finding.title)} <span class="muted small">${escapeHtml(finding.id)}</span></h4>
${finding.narration ? `<p class="narration">${escapeHtml(finding.narration)} <span class="muted small">(narration: ${escapeHtml(narratorLabel ?? 'the narrator')})</span></p>` : ''}
${details('Evidence', pre(finding.evidence), { className: 'more' })}
${files}<p class="small muted">Source: ${escapeHtml(finding.source)}${where ? `; ${escapeHtml(where)}` : ''}</p></div>`;
}

/**
 * How many findings the narration covered and why the others have none, from findings.json: the lexical guard dropped
 * a narration (it may only restate its evidence), or the model returned none (src/findings/narrate.ts).
 */
export function narrationOutcome(narration: Pick<NarrationRecord, 'narrated' | 'dropped' | 'notReturned'>, findings?: number): string {
  const sent = narration.narrated + narration.dropped.length + narration.notReturned.length;
  const unsent = findings !== undefined && findings > sent ? ` of the ${count(sent)} findings sent (${count(findings - sent)} more were not sent: the narration takes the first ${count(sent)})` : '';
  const drops = [
    narration.dropped.length ? `${plural(narration.dropped.length, 'narration')} dropped by the lexical guard (a narration may only restate its evidence)` : '',
    narration.notReturned.length ? `${plural(narration.notReturned.length, 'finding')} with no narration returned by the model` : '',
  ].filter(Boolean);
  return `${plural(narration.narrated, 'finding')} narrated${unsent}${drops.length ? `; ${drops.join(', ')}` : ''}`;
}

function findingsSection(data: RunReportData): Section {
  const document = data.findings;
  if (!document) {
    const list = data.state.findings.length
      ? table([{ label: 'Kind' }, { label: 'Where' }, { label: 'Detail' }], data.state.findings.map((finding) => [code(finding.kind), escapeHtml(finding.step !== undefined ? `step ${finding.step}` : finding.rung ?? ''), escapeHtml(finding.detail)]))
      : '<p>None.</p>';
    return { id: 'findings', title: 'Findings: recorded, never fixed', body: `<p>No findings/findings.json; these are run.json's own findings.</p>${list}` };
  }
  const byKind = new Map<string, Finding[]>();
  for (const finding of document.findings) byKind.set(finding.kind, [...(byKind.get(finding.kind) ?? []), finding]);
  const rank = (kind: string) => (leadingKinds.includes(kind) ? leadingKinds.indexOf(kind) : leadingKinds.length);
  const kinds = [...byKind].sort((left, right) => rank(left[0]) - rank(right[0]) || right[1].length - left[1].length || compare(left[0], right[0]));
  const narration = document.narration;
  const unnarrated = narration ? [
    ...narration.dropped.map((drop) => [code(drop.id), escapeHtml(`dropped by the guard: ${drop.reason}`)]),
    ...narration.notReturned.map((missing) => [code(missing.id), escapeHtml(missing.reason)]),
  ] : [];
  const narrationLine = narration
    ? `<p class="small">Narration: ${escapeHtml(narration.label)} (${code(narration.model)}), ${narration.calls} calls, ${usd(narration.costUsd)} when recorded${narration.replayed ? ', replayed here' : ''}; ${escapeHtml(narrationOutcome(narration, document.findings.length))}.</p>${unnarrated.length ? details('Findings sent without a narration', table([{ label: 'Finding' }, { label: 'Why' }], unnarrated), { className: 'more' }) : ''}`
    : '<p class="small">No narration: every finding shows its deterministic evidence only.</p>';
  const body = `<p>A good restructure makes existing bugs obvious; fixing them is never part of it. These ${count(document.findings.length)} findings were found by deterministic collectors and are left exactly as they are in the code.</p>
${table([{ label: 'Kind' }, { label: 'Findings', numeric: true }], kinds.map(([kind, findings]) => [link(`#kind-${kind}`, kind), count(findings.length)]))}
${narrationLine}
${details('Sources', table([{ label: 'Source' }, { label: 'What it contributed' }], document.sources.map((source) => [code(source.name), escapeHtml(source.detail)])), { className: 'more' })}
${kinds.map(([kind, findings]) => `<h3 id="kind-${escapeHtml(kind)}">${escapeHtml(kind)} (${findings.length})</h3>\n${[...findings].sort((left, right) => right.weight - left.weight || compare(left.id, right.id)).map((finding) => findingBlock(finding, narration ? modelLabel(narration.model) : null)).join('\n')}`).join('\n')}
<p class="small">${attachmentLinks(data, [['findings/findings.json', 'findings.json'], ['findings/findings.md', 'findings.md'], ['findings/pr-body.md', 'the PR body']]).join(' · ')}</p>`;
  return { id: 'findings', title: 'Findings: recorded, never fixed', body };
}

/** The heatmap's pointer to the findings log: how many multi-writer-table findings it records. */
function multiWriterFindings(data: RunReportData): string {
  const findings = (data.findings?.findings ?? []).filter((finding) => finding.kind === 'multi-writer-table').length;
  return findings ? `The findings log records ${plural(findings, 'multi-writer-table finding')}, not fixed.` : 'The findings log records no multi-writer-table finding.';
}

function heatmapSection(data: RunReportData): Section {
  const heatmap = data.heatmap;
  if (!heatmap) return { id: 'tables', title: 'Table access', body: '<p>No plan/plan.json with the planner\'s facts in this run dir, so there are no table accesses to show.</p>' };
  const columns = heatmap.groups.map((group) => ({ key: group, label: group }));
  const multi = heatmap.tables.filter((table) => table.multiWriter);
  const rows = heatmap.tables.map((table) => ({ key: table.name, label: `${table.multiWriter ? '⚠ ' : ''}${table.name}` }));
  const multiWriters = new Set(multi.map((table) => table.name));
  const cells: MatrixCell[] = heatmap.cells.map((cell) => ({
    row: cell.table, column: cell.group, value: cell.writers ? 2 : 1,
    color: cell.writers && multiWriters.has(cell.table) ? 'var(--s2)' : 'var(--s1)',
    opacity: cell.writers ? 1 : 0.3,
    tip: `${cell.table} in ${cell.group}\n${cell.writers ? `written by ${plural(cell.writers, 'file')}` : ''}${cell.writers && cell.readers ? ', ' : ''}${cell.readers ? `read by ${plural(cell.readers, 'file')}` : ''}${multiWriters.has(cell.table) ? '\nwritten by several groups' : ''}`,
  }));
  const keyLegend = legend([
    { id: 'write', label: 'written by the group', color: 'var(--s1)' },
    { id: 'read', label: 'read only', color: 'color-mix(in srgb, var(--s1) 30%, transparent)' },
    { id: 'multi', label: 'written, by one of several groups (⚠)', color: 'var(--s2)' },
  ]);
  const tableView = table([{ label: 'Table' }, { label: 'Written by' }, { label: 'Read only by' }],
    heatmap.tables.map((table) => [`${table.multiWriter ? '⚠ ' : ''}${code(table.name)}`, table.writerGroups.map((group) => code(group)).join(' ') || '–', table.readerGroups.map((group) => code(group)).join(' ') || '–']));
  const body = `<p>${count(heatmap.tables.length)} table names × the ${count(heatmap.groups.length)} groups whose files touch them, from the planner's facts at the base commit (Kysely, Prisma and Drizzle call shapes), mapped through the plan's placements${data.state.pins.length ? '; pinned files count under `pinned`' : ''}. ${multi.length ? `${plural(multi.length, 'table is', 'tables are')} written by files of several groups: ${multi.map((table) => `${code(table.name)} (${table.writerGroups.map((group) => code(group)).join(', ')})`).join('; ')}. ${multiWriterFindings(data)}` : 'Every table is written by at most one group.'}</p>
${figure('Table access by group', `${keyLegend}${matrix(rows, columns, cells, { cell: 13, labelWidth: 190 })}`, { caption: 'Rows are tables, ordered under the first group that writes them; columns are groups in plan order. The facts read table names from query call shapes. Under planner rules 1 (immich\'s recorded plan) a common table expression\'s alias (<code>.with(\'cte\', …)</code>) shows up as a read-only table; rules 2 (S8) leave out an alias read inside the query that declares it.', tableView })}`;
  return { id: 'tables', title: 'Table access', body };
}

function costSection(data: RunReportData): Section {
  const { state, ledger } = data;
  const narration = data.findings?.narration ?? null;
  const thisRun = `<p>This run: the plan cost ${state.cost.planRecordedUsd === null ? 'an unknown amount' : usd(state.cost.planRecordedUsd)} when it was recorded; planner spend during the run ${usd(state.cost.llmUsd)}${state.cost.budgetRun || state.cost.mode ? ` (${[state.cost.budgetRun ? `budget run ${code(state.cost.budgetRun)}` : '', state.cost.mode ? `mode ${escapeHtml(state.cost.mode)}` : ''].filter(Boolean).join(', ')})` : ''}${narration ? `; the findings narration ${usd(narration.costUsd)} in ${narration.calls} calls of ${escapeHtml(narration.label)}${narration.replayed ? ' (replayed, $0 now)' : ''}` : ''}. Replaying ${narration ? 'the plan and the narration' : 'the plan'} from the committed cassettes costs $0.</p>`;
  if (!ledger) return { id: 'cost', title: 'Cost', body: `${thisRun}<p>No budget/ledger.jsonl in this package.</p>` };
  const g3Usd = ledger.runs.filter((run) => run.run.startsWith('g3-') || run.run.startsWith('g3u-')).reduce((sum, run) => sum + run.costUsd, 0);
  const carriedRuns = ledger.runs.filter((run) => run.notes.some((note) => note.startsWith('carried over'))).map((run) => run.run);
  const bars = ledger.runs.map((run) => ({
    label: run.run, value: run.costUsd, valueLabel: `${usd(run.costUsd)}${run.capUsd !== null ? ` of ${usd(run.capUsd, 2)}` : ''}`,
    tip: `${run.run}: ${usd(run.costUsd)} in ${count(run.calls)} paid calls${run.models.length ? `\n${run.models.join(', ')}` : ''}`,
  }));
  const tableView = table([{ label: 'Budget run' }, { label: 'Paid calls', numeric: true }, { label: 'Cost', numeric: true }, { label: 'Cap', numeric: true }, { label: 'Models' }, { label: 'Notes' }],
    [...ledger.runs.map((run) => [code(run.run), count(run.calls), usd(run.costUsd), run.capUsd === null ? '–' : usd(run.capUsd, 2), escapeHtml(run.models.join(', ') || '–'), `<span class="small">${escapeHtml(run.notes.join(' '))}${run.openReservationsUsd ? ` open reservations ${usd(run.openReservationsUsd)}` : ''}</span>`]),
      ['<strong>total</strong>', count(ledger.runs.reduce((sum, run) => sum + run.calls, 0)), `<strong>${usd(ledger.totalUsd)}</strong>`, ledger.globalCapUsd === null ? '–' : usd(ledger.globalCapUsd, 2), '', '']]);
  const body = `${thisRun}
<p>The whole project's spend on Nebius Token Factory, from the gateway's ledger (budget/ledger.jsonl): ${usd(ledger.totalUsd)}${ledger.globalCapUsd !== null ? ` of the ${usd(ledger.globalCapUsd, 2)} hard cap` : ''}. ${g3Usd > 0 ? `The G3 runs (opencode with Nemotron 3 Super and, in S9, with Ultra: the generic-agent baseline) account for ${usd(g3Usd)} of it. ` : ''}${carriedRuns.length ? `${carriedRuns.length === 1 ? 'The run' : 'The runs'} ${carriedRuns.map((run) => code(run)).join(', ')} ${carriedRuns.length === 1 ? 'is' : 'are'} carried over from the gate spike as one line each.` : ''}</p>
${figure('LLM spend by budget run', horizontalBars(bars, { labelWidth: 110 }), { tableView })}`;
  return { id: 'cost', title: 'Cost', body };
}

function abSection(data: RunReportData, links: AbLinks): Section | null {
  if (!data.ab) return null;
  return {
    id: 'ab',
    title: 'A/B: the same task, a generic agent',
    body: `<p>G3 gave opencode 1.18.34 with NVIDIA Nemotron 3 Super on Nebius Token Factory the same restructure, with a fixed prompt and no human input. Its branches were certified in session S4 by our checker, the version before this run's (certificate format 1; K7 came later). The same agent on Nemotron 3 Ultra, the model ac plans with (S9), is on the site's A/B page: its single-shot changed nothing, and its persistent run hit its $12 cap in turn 1 with every import of the moved files dangling.</p>\n${renderAbTable(data.ab, links)}`,
  };
}

export function renderRunReport(data: RunReportData, options: RenderOptions = {}): string {
  const header = headerSection(data);
  const abLinks = options.abLinks ?? { certificate: () => null, run: () => null };
  const sections = [planSection(data), graphSection(data), ladderSection(data), findingsSection(data), heatmapSection(data), costSection(data), abSection(data, abLinks)]
    .filter((part): part is Section => part !== null);
  const scope = data.state.packageRoot ? `${data.state.packageRoot}/` : '';
  return page({
    title: `${data.state.profile.name} ${scope}: ac run ${data.name}`,
    ...(options.breadcrumbs ? { breadcrumbs: options.breadcrumbs } : {}),
    lead: header.lead,
    nav: sections.map((part) => [part.id, part.title.split(':')[0]!]),
    body: `${header.body}\n${sections.map(section).join('\n')}\n<p class="small muted">Rendered by ${code('ac report')} from the run dir; the certificate files sit next to this page.</p>`,
  });
}

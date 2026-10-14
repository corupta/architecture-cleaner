// The findings log of a run (plan §2.3, §3.2): deterministic collectors over the run directory (contract C7) and the
// target at the run's base commit, ranked, optionally narrated by Lightning, then written as findings/findings.json,
// findings/findings.md and findings/pr-body.md. Nothing here changes the target or the run; findings are never fixed.
import fs from 'node:fs';
import path from 'node:path';
import type { Gateway } from '../gateway/types.js';
import { backEdgeFindings, boundaryGraph, cycleFindings, planGraph } from './collect-graph.js';
import { godInjectionFindings, multiWriterTableFindings, planWarningFindings, testImportFindings } from './collect-facts.js';
import { certificateFindings, recordedRunFindings } from './collect-records.js';
import { defaultNarrationSettings, narrateFindings, type NarrationSettings } from './narrate.js';
import { findingsMarkdown, prBodyMarkdown, reportSection, topFindings } from './render.js';
import { readRunData, type RunData } from './run-data.js';
import { loadTarget, type Target } from './target.js';
import { toFinding, type CollectedFinding, type Finding, type FindingsDocument, type FindingSource } from './types.js';

export interface RunFindingsOptions {
  runDirectory: string;
  /** A clone that has the run's base commit; default run.json's repo, else its environment. */
  repo?: string;
  /** A checkout with node_modules (the facts' type checker); default run.json's environment. */
  environment?: string;
  /** null: no narration, evidence only. */
  gateway: Gateway | null;
  narration?: Partial<NarrationSettings>;
  log?: (message: string) => void;
}

export interface FindingsResult {
  document: FindingsDocument;
  /** Run-dir-relative files written. */
  written: string[];
  /** The body of report.md's "## Findings" section. */
  reportSection: string;
}

/** Kinds first in this order, then by source; within a kind, heavier first. */
const kindOrder = ['module-cycle', 'god-injection', 'multi-writer-table', 'back-edge', 'prod-imports-test'];
const sourceOrder: FindingSource[] = ['boundaries', 'plan-graph', 'facts', 'analyzer', 'run', 'certificate', 'validator'];
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const rankOf = (kind: string) => (kindOrder.includes(kind) ? kindOrder.indexOf(kind) : kindOrder.length);

export function rankFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => rankOf(a.kind) - rankOf(b.kind) || sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source)
    || byCodeUnit(a.kind, b.kind) || b.weight - a.weight || byCodeUnit(a.id, b.id));
}

/** Findings with the same id (one key reported by two collectors) merge: steps and certificates join. */
function merged(collected: CollectedFinding[]): Finding[] {
  const byId = new Map<string, Finding>();
  for (const finding of collected.map(toFinding)) {
    const seen = byId.get(finding.id);
    if (!seen) byId.set(finding.id, finding);
    else byId.set(finding.id, { ...seen, steps: [...new Set([...seen.steps, ...finding.steps])].sort((a, b) => a - b), certificates: [...new Set([...seen.certificates, ...finding.certificates])].sort(byCodeUnit) });
  }
  return [...byId.values()];
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message.split('\n')[0]! : String(error));

function targetFor(data: RunData, options: Pick<RunFindingsOptions, 'repo' | 'environment'>): Target {
  const { state } = data;
  const repo = options.repo ?? (fs.existsSync(state.repo) ? state.repo : state.environment);
  if (data.planText === null) throw new Error(`${state.plan.file} is missing`);
  return loadTarget({
    repo,
    environment: options.environment ?? state.environment,
    base: state.base,
    packageRoot: state.packageRoot,
    moduleRoot: state.moduleRoot,
    pins: state.profile.plan?.pins ?? [],
    planText: data.planText,
  });
}

/** Every deterministic finding of the run, ranked, with what each source contributed. */
export function collectFindings(data: RunData, options: Pick<RunFindingsOptions, 'repo' | 'environment' | 'log'>): { findings: Finding[]; sources: FindingsDocument['sources'] } {
  const log = options.log ?? (() => {});
  const sources: FindingsDocument['sources'] = [];
  const collected: CollectedFinding[] = [];
  const add = (name: FindingSource | 'target', found: CollectedFinding[], detail: string) => {
    collected.push(...found);
    sources.push({ name, detail });
  };
  let target: Target | null = null;
  try {
    log(`findings: facts at ${data.state.base.slice(0, 10)}`);
    target = targetFor(data, options);
    sources.push({ name: 'target', detail: `facts at ${data.state.base.slice(0, 10)}: ${target.facts.files.length} movable files, ${target.facts.edges.length} edges, ${target.plan.placements.length} placed by the plan` });
  } catch (error) {
    sources.push({ name: 'target', detail: `not read (${errorMessage(error)}): no cycle, table, injection, test-import or plan findings from the code` });
  }
  if (data.boundaries) {
    const graph = boundaryGraph(data.boundaries);
    const found = [...cycleFindings(graph), ...backEdgeFindings(data.boundaries)];
    add('boundaries', found, `boundaries/report.json: ${graph.sccs.length} strongly connected sets, ${data.boundaries.backEdges.length} back-edges`);
  } else if (target) {
    const graph = planGraph(target);
    add('plan-graph', cycleFindings(graph), `no boundaries/report.json (R4 didn't run): cycles from the plan's groups over the facts, ${graph.sccs.length} strongly connected sets; no back-edges without R4's order`);
  }
  if (target) {
    const tables = multiWriterTableFindings(target);
    const injection = godInjectionFindings(target);
    add('facts', [...tables, ...injection], `${tables.length} tables with writers in several groups, ${injection.length} god-injection base classes`);
    const imports = testImportFindings(target);
    add('analyzer', imports, `${target.productionFiles.length} production files analyzed, ${imports.length} import test code`);
    const plan = planWarningFindings(target);
    add('validator', plan.findings, `${plan.findings.length} warnings on the run's plan${plan.errors.length ? `; ${plan.errors.length} errors (facts and plan disagree): ${plan.errors.slice(0, 3).join('; ')}` : ''}`);
  }
  const certificates = certificateFindings(data.certificates);
  add('certificate', certificates, `${data.certificates.length} certificates read (steps, rungs, whole PR)`);
  const recorded = recordedRunFindings(data.state.findings);
  add('run', recorded, `${data.state.findings.length} run.json findings`);
  return { findings: rankFindings(merged(collected)), sources };
}

/** Collects, narrates (when a gateway is given) and writes findings/{findings.json, findings.md, pr-body.md}. */
export async function runFindings(options: RunFindingsOptions): Promise<FindingsResult> {
  const data = readRunData(options.runDirectory);
  const { state } = data;
  const { findings, sources } = collectFindings(data, options);
  let narration: FindingsDocument['narration'] = null;
  if (options.gateway) {
    const settings = { ...defaultNarrationSettings, ...options.narration };
    options.log?.(`findings: narrating up to ${settings.maxFindings} of ${findings.length} findings`);
    const narrated = await narrateFindings(options.gateway, topFindings(findings, findings.length), settings);
    for (const finding of findings) finding.narration = narrated.narrations.get(finding.id) ?? null;
    narration = narrated.record;
  }
  const document: FindingsDocument = {
    format: 'ac-findings/1',
    run: { base: state.base, head: state.head, branch: state.branch, status: state.status, packageRoot: state.packageRoot, profile: state.profile.name },
    sources,
    narration,
    findings,
  };
  const outputs = new Map([
    ['findings/findings.json', `${JSON.stringify(document, null, 1)}\n`],
    ['findings/findings.md', findingsMarkdown(document)],
    ['findings/pr-body.md', prBodyMarkdown(document, data)],
  ]);
  for (const [file, text] of outputs) {
    fs.mkdirSync(path.dirname(path.join(data.root, file)), { recursive: true });
    fs.writeFileSync(path.join(data.root, file), text);
  }
  return { document, written: [...outputs.keys()], reportSection: reportSection(document) };
}

/** report.md's "## Findings" body from a run directory's findings/findings.json, or null before `runFindings` wrote it. */
export function reportSectionOf(runDirectory: string): string | null {
  const file = path.join(runDirectory, 'findings', 'findings.json');
  return fs.existsSync(file) ? reportSection(JSON.parse(fs.readFileSync(file, 'utf8')) as FindingsDocument) : null;
}

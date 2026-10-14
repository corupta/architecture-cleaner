// R4's report (contract C8), written by the orchestrator to <run-dir>/boundaries/report.json, read by the findings
// log; and the one-line summary that goes into the R4 commit message with the command a target developer runs.
import type { AntiVacuityEntry } from './anti-vacuity.js';
import type { FolderGraph } from './folder-graph.js';
import type { BoundaryRule } from './rules.js';

interface ReportEdge {
  from: string;
  to: string;
  files: number;
  sample: { from: string; to: string }[];
}

export interface BoundaryReport {
  version: 1;
  packageRoot: string;
  moduleRoot: string;
  /** key: module/<m> | platform/<c> | shared | other:<package-relative dir> */
  folders: { key: string; path: string; files: number }[];
  /** Folder level, value and type-only imports. */
  edges: ReportEdge[];
  /** Strongly connected folder sets of size > 1 (the composition root left out: it imports every module). */
  sccs: string[][];
  /** The DAG order over module keys used for the allow-list. */
  order: string[];
  backEdges: ReportEdge[];
  /** Module key → package-relative files imported from outside it. */
  publicFiles: Record<string, string[]>;
  rules: { name: string; kind: string; severity: string; comment: string }[];
  /** Violations frozen in the known-violations file, per rule. */
  baseline: { rule: string; count: number }[];
  antiVacuity: AntiVacuityEntry[];
}

export interface ReportInput {
  graph: FolderGraph;
  sccs: string[][];
  order: string[];
  backEdges: FolderGraph['edges'];
  rules: BoundaryRule[];
  baselineCounts: Map<string, number>;
  antiVacuity: AntiVacuityEntry[];
}

const reportEdge = ({ from, to, files, sample }: FolderGraph['edges'][number]): ReportEdge => ({ from, to, files, sample });

export function boundaryReport({ graph, sccs, order, backEdges, rules, baselineCounts, antiVacuity }: ReportInput): BoundaryReport {
  return {
    version: 1,
    packageRoot: graph.layout.packageRoot,
    moduleRoot: graph.layout.moduleRoot,
    folders: graph.folders,
    edges: graph.edges.map(reportEdge),
    sccs,
    order,
    backEdges: backEdges.map(reportEdge),
    publicFiles: graph.publicFiles,
    rules: rules.map(({ name, kind, severity, comment }) => ({ name, kind, severity, comment })),
    baseline: rules.map((rule) => ({ rule: rule.name, count: baselineCounts.get(rule.name) ?? 0 })),
    antiVacuity,
  };
}

/** How the target's developers run the check themselves, from the package root. */
export function checkCommand(targets: string[], versions: { dependencyCruiser: string; typescript: string }): string {
  return `npx -y -p dependency-cruiser@${versions.dependencyCruiser} -p typescript@${versions.typescript} depcruise ${targets.join(' ')} --config .dependency-cruiser.json --ignore-known .dependency-cruiser-known-violations.json`;
}

export function boundarySummary(report: BoundaryReport, command: string): string {
  const known = report.baseline.reduce((sum, entry) => sum + entry.count, 0);
  const fired = report.antiVacuity.filter((entry) => entry.fired).length;
  const where = report.packageRoot ? `${report.packageRoot}/` : 'the repository root';
  return `${report.rules.length} rules over ${report.order.length} modules (${report.backEdges.length} back-edges against the DAG order), `
    + `${known} known violations frozen in the baseline, ${fired}/${report.antiVacuity.length} rules fired on their synthetic violation; `
    + `check from ${where} with \`${command}\``;
}

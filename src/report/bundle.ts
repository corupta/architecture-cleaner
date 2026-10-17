// `ac report`'s output: a static bundle per run (index.html plus the certificate JSON, the plan and the findings it
// links, copied byte for byte), deterministic and offline. graph.json is the one artifact derived from the repo: it is
// computed when the run's commits are reachable and graph.json is missing or stale, and read from the run dir otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { resolveCommit } from '../certificate/git-tree.js';
import { readRunState } from '../orchestrator/run-directory.js';
import type { RunState } from '../orchestrator/types.js';
import { computeRunGraph, graphFileName, graphJson, readRunGraph } from './graph.js';
import { renderRunReport, type RenderOptions } from './render.js';
import { readRunReport, type RunReportData } from './run-data.js';

export interface ReportInput {
  runDirectory: string;
  out: string;
  /** A clone with the run's commits (default: run.json's repo, when it still has them). */
  repo?: string;
  /** Recompute graph.json even when the stored one matches the run. */
  regraph?: boolean;
  /** Only read a stored graph.json, never compute one (the site builds from committed artifacts only). */
  storedGraphOnly?: boolean;
  /** This package's directory (budget/, runs/g3/). */
  packageDirectory: string;
  render?: RenderOptions;
  log?: (message: string) => void;
}

export interface ReportResult {
  out: string;
  /** Files written, out-relative, sorted. */
  files: string[];
  graph: 'stored' | 'computed' | 'missing';
  bytes: number;
  data: RunReportData;
}

/** Marks a directory as a report bundle, so the next build may replace it. */
export const reportMarker = '.ac-report';

/** A directory the build may write into: absent, empty, or carrying one of the markers. */
export function prepareOutput(out: string, markers: readonly string[]): void {
  if (fs.existsSync(out)) {
    const entries = fs.readdirSync(out);
    if (entries.length && !markers.some((marker) => entries.includes(marker))) {
      throw new Error(`${out} is not empty and is not an earlier build (no ${markers.join(' or ')}): choose an empty or new directory`);
    }
    fs.rmSync(out, { recursive: true, force: true });
  }
  fs.mkdirSync(out, { recursive: true });
}

const hasCommits = (repo: string, commits: string[]) => {
  try {
    for (const commit of commits) resolveCommit(repo, commit);
    return true;
  } catch {
    return false;
  }
};

/** graph.json for the run: the stored one when it matches, else computed from a repo that has both commits. */
export function ensureRunGraph(runDirectory: string, state: RunState, options: { repo?: string; regraph?: boolean; log?: (message: string) => void }): 'stored' | 'computed' | 'missing' {
  if (!options.regraph && readRunGraph(runDirectory, state)) return 'stored';
  const candidates = [options.repo, state.repo].filter((repo): repo is string => Boolean(repo) && fs.existsSync(repo!));
  const repo = candidates.find((candidate) => hasCommits(candidate, [state.base, state.head]));
  if (!repo) {
    options.log?.(`graph: no graph.json for ${state.base.slice(0, 10)}..${state.head.slice(0, 10)} and no reachable repo with both commits (tried ${candidates.join(', ') || 'none'}); the report has no module graph`);
    return 'missing';
  }
  const graph = computeRunGraph({ repo, environment: state.environment, state, ...(options.log ? { log: options.log } : {}) });
  fs.writeFileSync(path.join(runDirectory, graphFileName), graphJson(graph));
  options.log?.(`graph: computed from ${repo}, written to ${path.join(runDirectory, graphFileName)}`);
  return 'computed';
}

export function writeReport(input: ReportInput): ReportResult {
  const runDirectory = path.resolve(input.runDirectory);
  const out = path.resolve(input.out);
  if (out === runDirectory || out.startsWith(`${runDirectory}${path.sep}`)) throw new Error('--out must be outside the run dir');
  const state = readRunState(runDirectory);
  const graph = input.storedGraphOnly
    ? (readRunGraph(runDirectory, state) ? 'stored' : 'missing')
    : ensureRunGraph(runDirectory, state, { ...(input.repo ? { repo: input.repo } : {}), ...(input.regraph ? { regraph: true } : {}), ...(input.log ? { log: input.log } : {}) });
  const data = readRunReport(runDirectory, { packageDirectory: input.packageDirectory });
  prepareOutput(out, [reportMarker]);
  const files: string[] = [];
  for (const file of data.attachments) {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.copyFileSync(path.join(runDirectory, file), path.join(out, file));
    files.push(file);
  }
  fs.writeFileSync(path.join(out, 'index.html'), renderRunReport(data, input.render));
  fs.writeFileSync(path.join(out, reportMarker), '');
  files.push('index.html', reportMarker);
  const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join(out, file)).size, 0);
  return { out, files: files.sort(), graph, bytes, data };
}

// `ac site`: the replay site v1 (plan §4 "Demo URL"), built from committed artifacts only: every run dir under runs/
// (one report bundle each, graph.json read, never computed), runs/g3 (the A/B), bench/results and the Super VL
// experiment's results under bench/experiments (the benchmarks) and the budget ledger. Offline and deterministic;
// relative links and .nojekyll, so GitHub Pages serves it as is.
import fs from 'node:fs';
import path from 'node:path';
import { compare } from '../boundaries/folder-graph.js';
import { abTableView, readAbDocument, type AbTableView } from '../report/ab.js';
import { prepareOutput, writeReport } from '../report/bundle.js';
import type { AbLinks } from '../report/render-ab.js';
import type { RunReportData } from '../report/run-data.js';
import { readBenchResults } from './bench.js';
import { abPage, benchPage, landingPage, verifyPage, type SiteContext } from './pages.js';
import { readSuperVlExperiment, superVlFiles } from './super-vl.js';

export interface SiteInput {
  /** This package's directory: runs/, bench/results/, bench/experiments/, budget/ are read from it. */
  packageDirectory: string;
  out: string;
  /** The source repository's URL for the landing and verify pages (GitHub Actions passes it), or null. */
  sourceUrl?: string | null;
  log?: (message: string) => void;
}

export interface SiteResult {
  out: string;
  /** Files written, out-relative, sorted. */
  files: string[];
  runs: { name: string; graph: 'stored' | 'computed' | 'missing' }[];
  bytes: number;
}

/** Marks a directory as a site build, so the next build may replace it. */
export const siteMarker = '.ac-site';

/** Committed run dirs (with a run.json) under runs/, by name. */
export function committedRuns(packageDirectory: string): string[] {
  const directory = path.join(packageDirectory, 'runs');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, 'run.json')))
    .map((entry) => entry.name)
    .sort(compare);
}

/** Runs with a whole-PR certificate first, then runs without an injected fault, then by name. */
export const runOrder = (left: RunReportData, right: RunReportData) =>
  Number(!left.whole) - Number(!right.whole) || Number(Boolean(left.state.fault)) - Number(Boolean(right.state.fault)) || compare(left.name, right.name);

function listFiles(root: string, relative = ''): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(root, child));
    else files.push(child);
  }
  return files;
}

export function buildSite(input: SiteInput): SiteResult {
  const out = path.resolve(input.out);
  const root = input.packageDirectory;
  prepareOutput(out, [siteMarker]);
  const names = committedRuns(root);
  const inSite = new Set(names);
  /** The site run a package-relative file belongs to (runs/<name>/...), if that run has a bundle. */
  const siteRunOf = (file: string) => {
    const name = /^runs\/([^/]+)\//.exec(file)?.[1];
    return name && inSite.has(name) ? name : null;
  };
  /** A certificate named package-relative: its copy in a run bundle, else the A/B page's copy. */
  const certificateHref = (toRoot: string, toAb: string) => (file: string) => (siteRunOf(file) ? `${toRoot}${file}` : `${toAb}certificates/${path.posix.basename(file)}`);
  const runHref = (toRoot: string) => (name: string) => (inSite.has(name) ? `${toRoot}runs/${name}/index.html` : null);

  const runLinks: AbLinks = { certificate: certificateHref('../../', '../../ab/'), run: runHref('../../') };
  const reports = names.map((name) => {
    const result = writeReport({
      runDirectory: path.join(root, 'runs', name),
      out: path.join(out, 'runs', name),
      packageDirectory: root,
      storedGraphOnly: true,
      render: { breadcrumbs: [['../../index.html', 'home']], abLinks: runLinks },
    });
    if (result.graph === 'missing') input.log?.(`runs/${name}: no graph.json, so its report has no module graph; create it once with \`ac report runs/${name} --out <dir> --repo <clone>\``);
    return { name, result };
  });

  const ab = readAbDocument(path.join(root, 'runs', 'g3', 'ab.json'));
  const abViews: AbTableView[] = ab ? ab.tables.map((table) => abTableView(table, root)) : [];
  for (const view of abViews) {
    for (const certificate of Object.values(view.certificates)) {
      if (!certificate || siteRunOf(certificate.file)) continue;
      const target = path.join(out, 'ab', 'certificates', path.posix.basename(certificate.file));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, certificate.file), target);
    }
  }

  const resultsDirectory = path.join(root, 'bench', 'results');
  const bench = readBenchResults(resultsDirectory);
  if (bench.length) {
    fs.mkdirSync(path.join(out, 'bench', 'results'), { recursive: true });
    for (const file of fs.readdirSync(resultsDirectory).filter((name) => name.endsWith('.json') || name === 'summary.md').sort(compare)) {
      fs.copyFileSync(path.join(resultsDirectory, file), path.join(out, 'bench', 'results', file));
    }
  }

  const superVl = readSuperVlExperiment(root);
  for (const file of superVl ? superVlFiles(root, superVl) : []) {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(out, file));
  }

  const context: SiteContext = { runs: reports.map(({ result }) => result.data).sort(runOrder), ab: abViews, bench, superVl, sourceUrl: input.sourceUrl ?? null };
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.writeFileSync(path.join(out, file), text);
  };
  write('index.html', landingPage(context));
  write('ab/index.html', abPage(context, { certificate: certificateHref('../', ''), run: runHref('../') }));
  write('bench/index.html', benchPage(context));
  write('verify/index.html', verifyPage(context));
  write('.nojekyll', '');
  write(siteMarker, '');
  const files = listFiles(out).sort(compare);
  return {
    out,
    files,
    runs: reports.map(({ name, result }) => ({ name, graph: result.graph })),
    bytes: files.reduce((sum, file) => sum + fs.statSync(path.join(out, file)).size, 0),
  };
}

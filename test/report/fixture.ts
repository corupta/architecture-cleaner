// A small synthetic run dir for the report and site tests: a real git chain (base, two R1 steps, an R3 rename, R4's
// rules file) and a run.json whose step 2 failed once under an injected fault, was rolled back, pinned a file and then
// passed. Certificates are format ac-certificate/2 stand-ins with the fields the report reads.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarize } from '../../src/certificate/report.js';
import type { Certificate, CheckId, CheckResult } from '../../src/certificate/types.js';
import type { FindingsDocument } from '../../src/findings/types.js';
import type { AttemptRecord, CertificateRecord, RunState, StepRecord } from '../../src/orchestrator/types.js';
import { commitChain, type Tree } from '../certificate/two-commit-repo.js';

const tsconfig = JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', strict: true } });
const packageJson = JSON.stringify({ name: 'shop', type: 'module' });

export const baseTree: Tree = {
  'package.json': packageJson,
  'tsconfig.json': tsconfig,
  'src/app.ts': "import { userController } from './controllers/user.controller.js';\nimport { orderController } from './controllers/order.controller.js';\nexport const app = [userController, orderController];\n",
  'src/controllers/user.controller.ts': "import { users } from '../services/user.service.js';\nexport const userController = () => users;\n",
  'src/controllers/user.controller.spec.ts': "import { userController } from './user.controller.js';\nuserController();\n",
  'src/controllers/order.controller.ts': "import { orders } from '../services/order.service.js';\nimport { users } from '../services/user.service.js';\nexport const orderController = () => [orders, users];\n",
  'src/services/user.service.ts': "export const users = ['ada'];\n",
  'src/services/order.service.ts': "import { users } from './user.service.js';\nexport const orders = users.map((user) => `${user}-order`);\n",
};

const step1Tree: Tree = {
  'package.json': packageJson,
  'tsconfig.json': tsconfig,
  'src/app.ts': "import { userController } from './modules/user/user.controller.js';\nimport { orderController } from './controllers/order.controller.js';\nexport const app = [userController, orderController];\n",
  'src/modules/user/user.controller.ts': "import { users } from './user.service.js';\nexport const userController = () => users;\n",
  'src/modules/user/user.controller.spec.ts': "import { userController } from './user.controller.js';\nuserController();\n",
  'src/controllers/order.controller.ts': "import { orders } from '../services/order.service.js';\nimport { users } from '../modules/user/user.service.js';\nexport const orderController = () => [orders, users];\n",
  'src/modules/user/user.service.ts': "export const users = ['ada'];\n",
  'src/services/order.service.ts': "import { users } from '../modules/user/user.service.js';\nexport const orders = users.map((user) => `${user}-order`);\n",
};

const step2Tree: Tree = {
  ...Object.fromEntries(Object.entries(step1Tree).filter(([file]) => file !== 'src/controllers/order.controller.ts')),
  'src/app.ts': "import { userController } from './modules/user/user.controller.js';\nimport { orderController } from './modules/order/order.controller.js';\nexport const app = [userController, orderController];\n",
  'src/modules/order/order.controller.ts': "import { orders } from '../../services/order.service.js';\nimport { users } from '../user/user.service.js';\nexport const orderController = () => [orders, users];\n",
};

const step3Tree: Tree = {
  ...Object.fromEntries(Object.entries(step2Tree).filter(([file]) => file !== 'src/modules/order/order.controller.ts')),
  'src/app.ts': "import { userController } from './modules/user/user.controller.js';\nimport { orderController } from './modules/order/orders.controller.js';\nexport const app = [userController, orderController];\n",
  'src/modules/order/orders.controller.ts': step2Tree['src/modules/order/order.controller.ts']!,
};

const step4Tree: Tree = { ...step3Tree, '.dependency-cruiser.json': '{"forbidden":[]}\n' };

const allChecks: CheckId[] = ['K0', 'K1', 'K2', 'K3a', 'K3b', 'K3c', 'K4', 'K6', 'K7'];

/** A format-2 certificate with the given verdict; `failing` checks fail, the rest pass. */
export function certificateJson(options: { base: string; head: string; scope: 'static' | 'full'; failing?: CheckId[]; moves?: number }): Certificate {
  const failing = options.failing ?? [];
  const ids = options.scope === 'full' ? [...allChecks, 'K8' as const] : allChecks;
  const checks: CheckResult[] = ids.map((id) => ({
    id, title: `Check ${id}`, status: failing.includes(id) ? 'fail' : 'pass',
    summary: failing.includes(id) ? `${id} found 1 violation` : `${id} holds`,
    metrics: id === 'K2' ? { comparedFiles: 3, editedFiles: 3, changedSpans: 4 } : ({} as Record<string, number>),
    violations: failing.includes(id) ? [{ file: 'src/app.ts', detail: `line 2: import resolves elsewhere under ${id}` }] : [],
    findings: [], durationMs: 1000,
  }));
  const verdict = failing.length ? 'fail' : 'pass';
  const digest = `sha256:${crypto.createHash('sha256').update(JSON.stringify([options.base, options.head, options.scope, failing])).digest('hex')}`;
  return {
    format: 'ac-certificate/2', tool: { name: 'architecture-cleaner', version: '0.1.0' }, repo: '/fixture', base: options.base, head: options.head,
    baseTree: `${options.base.slice(0, 20)}tree`, headTree: `${options.head.slice(0, 20)}tree`, packageRoot: '', profile: 'shop',
    environment: { checkout: '/fixture', node: 'system', linkedNodeModules: [] }, workDir: '/fixture/work',
    pathMap: { moves: options.moves ?? 2, unchanged: 3, editedInPlace: 1, deleted: [], added: [], ambiguousGroups: 0, entries: {} },
    checks, verdict, scope: options.scope, residualRisk: ['stack-trace and source-map text'], digest,
  };
}

export interface RunFixture {
  /** The run dir. */
  directory: string;
  /** The git chain the run's commits live in. */
  repo: string;
  commits: string[];
  state: RunState;
}

function store(directory: string, file: string, certificate: Certificate, withSummary = true): CertificateRecord {
  const absolute = path.join(directory, `${file}.json`);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(certificate, null, 1)}\n`);
  if (withSummary) fs.writeFileSync(path.join(directory, `${file}.txt`), `[certify] K0 Envelope\n${summarize(certificate)}\n`);
  const failing = certificate.checks.filter((check) => check.status === 'fail' || check.status === 'error').map((check) => check.id);
  return { file: `${file}.json`, verdict: certificate.verdict, scope: certificate.scope, digest: certificate.digest, base: certificate.base, head: certificate.head, failing };
}

const attempt = (fields: Partial<AttemptRecord> & Pick<AttemptRecord, 'attempt' | 'state' | 'parent'>): AttemptRecord => ({
  round: 1, moves: 2, offending: [], pinned: [], detail: '', startedAt: '2026-10-14T19:00:00.000Z', durationMs: 90_000, timings: { moveMs: 8000, commitMs: 50, certifyMs: 80_000, amendMs: 50 }, ...fields,
});

/** Builds the run dir (and its git chain) in a fresh temp directory. */
export function makeRunFixture(): RunFixture {
  const { root: repo, commits } = commitChain([baseTree, step1Tree, step2Tree, step3Tree, step4Tree]);
  const [base, c1, c2, c3, c4] = commits as [string, string, string, string, string];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-report-run-'));
  const step1Certificate = store(directory, 'certificates/001-R1-module-user', certificateJson({ base, head: c1, scope: 'static', moves: 3 }));
  const failedCertificate = store(directory, 'certificates/failed/002-R1-module-order-attempt1', certificateJson({ base: c1, head: 'f'.repeat(40), scope: 'static', failing: ['K3a', 'K3b'] }));
  const step2Certificate = store(directory, 'certificates/002-R1-module-order', certificateJson({ base: c1, head: c2, scope: 'static', moves: 1 }), false);
  const step3Certificate = store(directory, 'certificates/003-R3-module-order', certificateJson({ base: c2, head: c3, scope: 'static', moves: 1 }));
  const r1 = store(directory, 'rungs/R1', certificateJson({ base, head: c2, scope: 'full', moves: 4 }));
  const r3 = store(directory, 'rungs/R3', certificateJson({ base: c2, head: c3, scope: 'full', moves: 1 }));
  const r4 = store(directory, 'rungs/R4', certificateJson({ base: c3, head: c4, scope: 'full', moves: 0 }));
  const whole = store(directory, 'certificate', certificateJson({ base, head: c4, scope: 'full', moves: 4 }));
  store(directory, 'rungs/failed/R1', certificateJson({ base, head: c2, scope: 'full', failing: ['K8'] }));
  const steps: StepRecord[] = [
    {
      index: 1, rung: 'R1', group: 'module/user', round: 1, status: 'certified', parent: base, commit: c1, tree: 'a'.repeat(40), durationMs: 90_000,
      moves: { 'src/controllers/user.controller.ts': 'src/modules/user/user.controller.ts', 'src/controllers/user.controller.spec.ts': 'src/modules/user/user.controller.spec.ts', 'src/services/user.service.ts': 'src/modules/user/user.service.ts' },
      entries: [['src/controllers/user.controller.ts', 'src/controllers/user.controller.spec.ts'], ['src/services/user.service.ts']],
      attempts: [attempt({ attempt: 1, state: 'passed', parent: base, moves: 3, commit: c1, certificate: step1Certificate })],
      certificate: step1Certificate, counts: { filesMoved: 3, specifierEdits: 4, filesEdited: 3 },
      pathMap: { 'src/controllers/user.controller.ts': 'src/modules/user/user.controller.ts', 'src/controllers/user.controller.spec.ts': 'src/modules/user/user.controller.spec.ts', 'src/services/user.service.ts': 'src/modules/user/user.service.ts' },
    },
    {
      index: 2, rung: 'R1', group: 'module/order', round: 1, status: 'certified', parent: c1, commit: c2, tree: 'b'.repeat(40), durationMs: 200_000,
      moves: { 'src/controllers/order.controller.ts': 'src/modules/order/order.controller.ts', 'src/services/order.service.ts': 'src/modules/order/order.service.ts' },
      entries: [['src/controllers/order.controller.ts'], ['src/services/order.service.ts']],
      attempts: [
        attempt({
          attempt: 1, state: 'failed', parent: c1, commit: 'f'.repeat(40), certificate: failedCertificate,
          injectedFault: { operator: 'M2', description: 'M2 (Drop one importer rewrite): src/app.ts keeps its base specifier' },
          offending: ['src/services/order.service.ts'], pinned: ['src/services/order.service.ts'],
          detail: 'certificate FAIL (K3a, K3b): K3a src/app.ts: line 2: import resolves elsewhere',
          timings: { moveMs: 8000, commitMs: 50, faultMs: 30, certifyMs: 80_000, rollbackMs: 40 },
        }),
        attempt({ attempt: 2, state: 'passed', parent: c1, moves: 1, commit: c2, certificate: step2Certificate }),
      ],
      certificate: step2Certificate, counts: { filesMoved: 1, specifierEdits: 3, filesEdited: 2 },
      pathMap: { 'src/controllers/order.controller.ts': 'src/modules/order/order.controller.ts' },
    },
    {
      index: 3, rung: 'R3', group: 'module/order', round: 1, status: 'certified', parent: c2, commit: c3, tree: 'c'.repeat(40), durationMs: 85_000,
      moves: { 'src/modules/order/order.controller.ts': 'src/modules/order/orders.controller.ts' }, entries: [['src/modules/order/order.controller.ts']],
      attempts: [attempt({ attempt: 1, state: 'passed', parent: c2, moves: 1, commit: c3, certificate: step3Certificate })],
      certificate: step3Certificate, counts: { filesMoved: 1, specifierEdits: 1, filesEdited: 1 },
      pathMap: { 'src/modules/order/order.controller.ts': 'src/modules/order/orders.controller.ts' },
    },
    {
      index: 4, rung: 'R4', group: 'boundaries', round: 1, status: 'certified', parent: c3, commit: c4, tree: 'd'.repeat(40), durationMs: 0, moves: {}, entries: [],
      attempts: [attempt({ attempt: 1, state: 'passed', parent: c3, moves: 0, commit: c4, certificate: { ...r4 }, timings: { commitMs: 50, certifyMs: 120_000 }, detail: '2 rules over 2 modules' })],
      certificate: r4, pathMap: {},
    },
  ];
  const state: RunState = {
    format: 'ac-run/1', status: 'completed', tool: { name: 'architecture-cleaner', version: '0.1.0' }, repo, environment: repo,
    profile: { name: 'shop', packageRoot: '', node: 'system' }, packageRoot: '', moduleRoot: 'src', base, baseTree: 'e'.repeat(40), branch: 'ac/fixture', head: c4,
    plan: { file: 'plan/plan.yaml', source: 'planner', sha256: '0'.repeat(64), steps: 2, moves: 5 },
    rungsRequested: ['R0', 'R1', 'R2', 'R3', 'R4'], options: { jobs: 1, injectFault: { step: '2', operator: 'M2' } },
    rungs: [
      { id: 'R0', status: 'passed', durationMs: 60_000, start: base },
      { id: 'R1', status: 'certified', durationMs: 400_000, start: base, end: c2, certificate: { ...r1, partial: false } },
      { id: 'R2', status: 'skipped', durationMs: 0, start: c2, end: c2, note: 'no R2 steps in the plan' },
      { id: 'R3', status: 'certified', durationMs: 100_000, start: c2, end: c3, certificate: { ...r3, partial: false } },
      { id: 'R4', status: 'certified', durationMs: 120_000, start: c3, end: c4, certificate: { ...r4, partial: false } },
    ],
    steps,
    pins: [{ file: 'src/services/order.service.ts', step: 2, group: 'module/order', reason: 'pinned' }],
    findings: [{ kind: 'injected-fault', step: 2, rung: 'R1', files: [], detail: 'seeded wrong move (--inject-fault): M2' }],
    quarantine: [],
    fault: { step: '2', operator: 'M2', appliedTo: 2, description: 'M2 (Drop one importer rewrite): src/app.ts keeps its base specifier', mutantCommit: 'f'.repeat(40) },
    certificate: whole,
    cost: { budgetRun: 's6', mode: 'replay', llmUsd: 0, planRecordedUsd: 0.1234 },
    timeline: { startedAt: '2026-10-14T19:00:00.000Z', finishedAt: '2026-10-14T19:12:00.000Z', durationMs: 720_000, preflightMs: 5000, baselineMs: 55_000, stepsMs: 375_000, rungCertificationMs: 220_000, bisectMs: 0, runCertificationMs: 60_000, resumedAt: [] },
  };
  fs.writeFileSync(path.join(directory, 'run.json'), `${JSON.stringify(state, null, 1)}\n`);
  fs.mkdirSync(path.join(directory, 'plan'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'plan', 'plan.yaml'), `version: 1
packageRoot: .
moduleRoot: src
sha: "${base}"
groups:
  module/order:
    - { path: src/controllers/order.controller.ts, confidence: seed }
    - { path: src/services/order.service.ts, confidence: contested, contested: true, source: planner, rationale: "Orders own the order service." }
  module/user:
    - { path: src/controllers/user.controller.ts, tests: [src/controllers/user.controller.spec.ts], confidence: seed }
    - { path: src/services/user.service.ts, confidence: seed }
`);
  const fact = (file: string, reads: string[], writes: string[]) => ({ path: file, id: 0, role: 'other', loc: 3, exports: [], primaryExport: null, tables: { reads, writes }, routes: [], tests: [] });
  fs.writeFileSync(path.join(directory, 'plan', 'plan.json'), `${JSON.stringify({
    facts: {
      packageRoot: '', moduleRoot: 'src', sha: base, edges: [], pins: [],
      files: [
        fact('src/controllers/order.controller.ts', ['orders'], []),
        fact('src/controllers/user.controller.ts', ['users'], []),
        fact('src/services/order.service.ts', ['orders', 'users'], ['orders', 'users']),
        fact('src/services/user.service.ts', ['users'], ['users']),
      ],
    },
    winner: 'ultra#1',
    critic: { critiques: [{ review: 'The plan keeps orders and users apart.' }] },
  }, null, 1)}\n`);
  const findings: FindingsDocument = {
    format: 'ac-findings/1',
    run: { base, head: c4, branch: 'ac/fixture', status: 'completed', packageRoot: '', profile: 'shop' },
    sources: [{ name: 'facts', detail: '1 table with writers in several groups' }],
    narration: { model: 'nvidia/Nemotron-3_5-Lightning', label: 'Nemotron 3.5 Lightning (thinking off)', calls: 1, costUsd: 0.0001, replayed: true, narrated: 1, dropped: [{ id: 'F-000000000002', reason: 'no narration returned' }] },
    findings: [
      { id: 'F-000000000001', kind: 'multi-writer-table', title: 'Table users is written by 2 groups', files: ['src/services/order.service.ts', 'src/services/user.service.ts'], evidence: 'Table users is written by 2 files in 2 plan groups:\n- module/order: src/services/order.service.ts\n- module/user: src/services/user.service.ts', source: 'facts', steps: [], certificates: [], weight: 2, narration: 'Two groups write the users table <on purpose>.' },
      { id: 'F-000000000002', kind: 'injected-fault', title: 'Seeded wrong move on step 2', files: [], evidence: 'seeded wrong move (--inject-fault): M2', source: 'run', steps: [2], certificates: [], weight: 1, narration: null },
    ],
  };
  fs.mkdirSync(path.join(directory, 'findings'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'findings', 'findings.json'), `${JSON.stringify(findings, null, 1)}\n`);
  fs.writeFileSync(path.join(directory, 'findings', 'pr-body.md'), '# PR body\n');
  return { directory, repo, commits, state };
}

/** A package directory for the site: the fixture run under runs/<name>, a G3-style A/B, a ledger, optional bench results. */
export function makePackageFixture(options: { bench?: boolean } = {}): { root: string; run: RunFixture } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-site-package-'));
  const run = makeRunFixture();
  fs.cpSync(run.directory, path.join(root, 'runs', 'shop-fault'), { recursive: true });
  fs.mkdirSync(path.join(root, 'runs', 'g3'), { recursive: true });
  const g3 = certificateJson({ base: run.state.base, head: '9'.repeat(40), scope: 'full', failing: ['K1', 'K6', 'K8'] });
  const { format: _format, baseTree: _baseTree, headTree: _headTree, profile: _profile, workDir: _workDir, ...rest } = g3;
  // Format 1 predates K7.
  const formatOne = { ...rest, format: 'ac-certificate/1', checks: rest.checks.filter((check) => check.id !== 'K7') };
  fs.writeFileSync(path.join(root, 'runs', 'g3', 'agent.full.json'), `${JSON.stringify(formatOne, null, 1)}\n`);
  fs.writeFileSync(path.join(root, 'runs', 'g3', 'ab.json'), `${JSON.stringify({
    format: 'ac-ab/1', about: 'fixture',
    tables: [{
      id: 'shop', title: 'shop @ base', target: { name: 'shop', origin: 'https://example.invalid/shop', base: run.state.base, packageRoot: '', profile: 'shop' },
      baseline: 'Base: 3 tests.',
      arms: [
        { id: 'ours', label: 'ac', who: 'architecture-cleaner', branch: 'ac/fixture', session: 'S7', ours: true, certificate: 'runs/shop-fault/certificate.json', run: 'shop-fault' },
        { id: 'agent', label: 'agent', who: 'a generic agent', branch: 'agent/x', session: 'G3', ours: false, certificate: 'runs/g3/agent.full.json' },
      ],
      rows: [{ metric: 'tsc errors (base: 0)', values: { ours: '0', agent: '12' }, source: 'docs/gates.md' }],
      notes: [{ text: 'Green tests are not proof.', source: 'docs/storyboard.md' }],
    }],
  }, null, 1)}\n`);
  fs.mkdirSync(path.join(root, 'budget'), { recursive: true });
  fs.writeFileSync(path.join(root, 'budget', 'ledger.jsonl'), [
    { ts: '2026-10-02T12:00:00.000Z', runId: 'g1', carried: 'spike', paidCalls: 3, costUsd: 1.5 },
    { ts: '2026-10-07T12:00:00.000Z', runId: 's6', model: 'nvidia/Nemotron-3-Ultra-550b-a55b', n: 1, promptTokens: 10, completionTokens: 20, costUsd: 0.25 },
  ].map((line) => JSON.stringify(line)).join('\n').concat('\n'));
  fs.writeFileSync(path.join(root, 'budget', 'runs.json'), JSON.stringify({ globalCap: 50, runs: { s6: { cap: 3 } } }));
  if (options.bench) {
    fs.mkdirSync(path.join(root, 'bench', 'results'), { recursive: true });
    fs.writeFileSync(path.join(root, 'bench', 'results', 'shop.json'), `${JSON.stringify(benchResultFixture(), null, 1)}\n`);
    fs.writeFileSync(path.join(root, 'bench', 'results', 'summary.md'), '# ac bench results\n');
  }
  return { root, run };
}

export function benchResultFixture() {
  const score = (method: string, kind: 'baseline' | 'draft' | 'planner', mojoFm: number, clusters: number) => ({
    method, kind, clusters, mojoFm, ari: mojoFm / 200, c2cCvg: 0.5, clusterCountRatio: clusters / 4, mojoFmHard: mojoFm - 10, turboMq: { sum: clusters / 2, mean: 0.1 }, backEdges: 2,
  });
  return {
    format: 'ac-bench/1', entry: 'shop', kind: 'scramble', variant: 'default', repo: '~/ac-targets/shop', sha: '1'.repeat(40), packageRoot: '', moduleRoot: 'src',
    files: 40, featureFiles: 36, groundTruthModules: 4, hardFiles: 6, leakyFiles: 1,
    scramble: { commit: '2'.repeat(40), tree: '3'.repeat(40), moved: 36, declined: 0, excluded: 4, certificate: { verdict: 'pass', scope: 'static', digest: 'sha256:abc', failing: [] } },
    methods: [score('B0 type folders', 'baseline', 20, 5), score('name-token (anchored)', 'baseline', 81.5, 4), score('seeds draft', 'draft', 80, 4), score('planner (Ultra)', 'planner', 78.25, 4)],
    bestBaseline: { method: 'name-token (anchored)', mojoFm: 81.5, turboMq: 2 },
    planner: { cassette: 'cassettes/s7-bench.jsonl', recordedCostUsd: 0.2, spentUsd: 0, replayed: true, groups: 4, planSha256: 'f'.repeat(64) },
    louvainMojoFmByResolution: { 1: [30, 31, 32, 33, 34] },
    notes: ['The planner loses to name-token here by 3.25 MoJoFM.'],
  };
}

/** The page's text as a reader sees it: tags dropped, entities decoded (so assertions on prose can't pass vacuously on escaping). */
export function pageText(html: string): string {
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

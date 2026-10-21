// `ac bench` end to end on a small fixture repo: a feature-modular package (base commit) and its type-folder flattening
// (a second commit the fake scramble checks out, as scrambleRepo would leave the worktree), a real entry on the same
// base, the planner through fake gateways (an answer, a replay miss, edit choices cut by the length cap), the results
// JSON, summary.md, and determinism; then --repeats, --planner and --cassette through the real gateway on a fake transport.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { benchCommand } from '../../src/bench/command.js';
import { compareReport, readComparedResults } from '../../src/bench/compare.js';
import { groundTruthOf, leakageNote, leakageOf, plannerNotes, readBenchManifest, runBench, type BenchOptions } from '../../src/bench/run.js';
import type { BenchManifest, BenchResult } from '../../src/bench/types.js';
import type { CassetteRecord } from '../../src/gateway/cassette.js';
import { createGateway } from '../../src/gateway/gateway.js';
import { models } from '../../src/gateway/models.js';
import type { RequestBody } from '../../src/gateway/request.js';
import type { Transport } from '../../src/gateway/transport.js';
import { GatewayError, type CassetteMode, type Gateway, type StructuredRequest, type StructuredResult } from '../../src/gateway/types.js';
import { plannerConfigurations, type PlannerConfigurationName } from '../../src/planner/configurations.js';
import type { Facts } from '../../src/planner/types.js';
import type { ScrambleEntity, ScrambleOptions, ScrambleResult } from '../../src/scramble/types.js';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-bench-test-'));
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));
const repo = path.join(temporary, 'repo');
const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@ac.invalid', ...args], { encoding: 'utf8' }).trim();

const service = (name: string, imports: [string, string][], extra = '') =>
  `${imports.map(([symbol, from]) => `import { ${symbol} } from '${from}';\n`).join('')}export class ${name} {\n  readonly uses = [${imports.map(([symbol]) => symbol).join(', ')}];\n${extra}}\n`;

/** Feature folders (truth) → their files, each with its imports by symbol. */
const files: { original: string; scrambled: string; truth: string; type: string; symbol: string; imports: string[] }[] = [
  { original: 'album/album.controller.ts', scrambled: 'controllers/album.controller.ts', truth: 'album', type: 'controller', symbol: 'AlbumController', imports: ['AlbumService'] },
  { original: 'album/album.service.ts', scrambled: 'services/album.service.ts', truth: 'album', type: 'service', symbol: 'AlbumService', imports: ['AlbumRepository', 'today'] },
  { original: 'album/album.repository.ts', scrambled: 'repositories/album.repository.ts', truth: 'album', type: 'repository', symbol: 'AlbumRepository', imports: [] },
  { original: 'user/user.controller.ts', scrambled: 'controllers/user.controller.ts', truth: 'user', type: 'controller', symbol: 'UserController', imports: ['UserService'] },
  { original: 'user/profile.controller.ts', scrambled: 'controllers/profile.controller.ts', truth: 'user', type: 'controller', symbol: 'ProfileController', imports: ['AvatarService', 'UserService'] },
  { original: 'user/user.service.ts', scrambled: 'services/user.service.ts', truth: 'user', type: 'service', symbol: 'UserService', imports: ['UserRepository'] },
  { original: 'user/avatar.service.ts', scrambled: 'services/avatar.service.ts', truth: 'user', type: 'service', symbol: 'AvatarService', imports: ['UserRepository', 'today'] },
  { original: 'user/user.repository.ts', scrambled: 'repositories/user.repository.ts', truth: 'user', type: 'repository', symbol: 'UserRepository', imports: [] },
];
const shared = { path: 'shared/date.ts', symbol: 'today' };

function writeTree(layout: 'original' | 'scrambled') {
  const source = path.join(repo, 'pkg', 'src');
  fs.rmSync(source, { recursive: true, force: true });
  const where = new Map<string, string>([[shared.symbol, shared.path], ...files.map((file) => [file.symbol, file[layout]] as [string, string])]);
  const specifier = (from: string, symbol: string) => {
    const relative = path.posix.relative(path.posix.dirname(from), where.get(symbol)!.replace(/\.ts$/, '.js'));
    return relative.startsWith('.') ? relative : `./${relative}`;
  };
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), text);
  };
  for (const file of files) write(file[layout], service(file.symbol, file.imports.map((symbol) => [symbol, specifier(file[layout], symbol)])));
  write(shared.path, 'export const today = () => new Date(0).toISOString();\n');
  write('main.ts', `${service('App', files.filter((file) => file.type === 'controller').map((file) => [file.symbol, specifier('main.ts', file.symbol)]))}`);
}

fs.mkdirSync(path.join(repo, 'pkg'), { recursive: true });
execFileSync('git', ['init', '-q', repo]);
fs.writeFileSync(path.join(repo, 'pkg', 'package.json'), '{ "name": "fixture", "type": "module", "main": "dist/main.js" }\n');
fs.writeFileSync(path.join(repo, 'pkg', 'tsconfig.json'), '{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "target": "es2022", "strict": true }, "include": ["src"] }\n');
writeTree('original');
git('add', '-A');
git('commit', '-q', '-m', 'feature folders');
const base = git('rev-parse', 'HEAD');
writeTree('scrambled');
git('add', '-A');
git('commit', '-q', '-m', 'type folders');
const scrambledCommit = git('rev-parse', 'HEAD');
git('checkout', '-q', '--detach', base);

const scrambleManifest = path.join(temporary, 'fixture.scramble.json');
fs.writeFileSync(scrambleManifest, JSON.stringify({ name: 'fixture', sha: base, packageRoot: 'pkg', moduleRoot: 'src', shared: ['shared'], exclude: [] }));

/** Leaves the worktree where scrambleRepo would: the scramble commit, on the branch it was given. */
const scrambleCalls: ScrambleOptions[] = [];
async function fakeScramble(options: ScrambleOptions): Promise<ScrambleResult> {
  scrambleCalls.push(options);
  execFileSync('git', ['-C', options.repo, 'checkout', '-q', '-b', options.branch!, scrambledCommit]);
  const entities: ScrambleEntity[] = [
    ...files.map((file): ScrambleEntity => ({ original: `src/${file.original}`, scrambled: `src/${file.scrambled}`, truth: file.truth, truthKind: 'feature', type: file.type, typeVia: 'suffix', leaky: false })),
    { original: 'src/shared/date.ts', scrambled: 'src/shared/date.ts', truth: 'shared:shared', truthKind: 'shared', type: 'util', typeVia: 'ast', leaky: false },
  ];
  return {
    format: 'ac-scramble/1', manifest: options.manifest, variant: options.variant, repo: options.repo, base, baseTree: git('rev-parse', `${base}^{tree}`),
    commit: scrambledCommit, tree: git('rev-parse', `${scrambledCommit}^{tree}`), branch: options.branch!, worktree: options.repo, entities,
    excluded: [{ path: 'src/main.ts', reason: 'outside the feature folders' }], declined: [], leakage: [{ path: 'src/album/album.e2e-spec.ts', reason: 'test with no co-located subject' }],
    certificate: { file: 'certificate.json', verdict: 'pass', scope: 'static', digest: `sha256:${'f'.repeat(64)}`, failing: [] },
  };
}

/** Answers like Ultra would: every draft group keeps its label, no moves; the critic has nothing to say. */
function fakeGateway(): Gateway & { calls(): number } {
  let calls = 0;
  return {
    calls: () => calls,
    async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      calls++;
      const schema = request.schema as { properties: { groups: { properties?: Record<string, unknown> } } };
      const answers = request.schemaName === 'plan_edit'
        ? Array.from({ length: request.n ?? 1 }, () => ({
          groups: Object.fromEntries(Object.keys(schema.properties.groups.properties!).map((key) => {
            const label = key.slice(key.indexOf(':') + 1);
            return [key, label === 'shared' ? { name: 'shared', kind: 'shared' } : label === 'registry' ? { name: 'registry', kind: 'platform' } : { name: label, kind: 'module' }];
          })),
          moves: [],
        }))
        : [{ review: 'The groups follow the features.', groups: [], moves: [] }];
      return {
        choices: answers.map((answer, index) => ({ index, finishReason: 'stop', value: request.parse(answer), reasoning: null })),
        usage: { promptTokens: 100, completionTokens: 10, reasoningTokens: 0 }, costUsd: 0.005, replayed: true, key: `fake:${calls}`,
      };
    },
    spent: () => ({ run: 0, global: 0 }),
  };
}

/**
 * Answers like ghostfolio's winning Ultra edit: every group re-kinded platform, every move naming a file by its bare id
 * (file i to the next draft group's label).
 */
function byIdGateway(): Gateway {
  return {
    async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const schema = request.schema as { properties: { groups: { properties?: Record<string, unknown> } } };
      const keys = request.schemaName === 'plan_edit' ? Object.keys(schema.properties.groups.properties!) : [];
      const labelOf = (key: string) => key.slice(key.indexOf(':') + 1);
      const answers = request.schemaName === 'plan_edit'
        ? Array.from({ length: request.n ?? 1 }, () => ({
          groups: Object.fromEntries(keys.map((key) => [key, { name: labelOf(key), kind: 'platform' }])),
          moves: keys.map((key, index) => ({ file: String(index + 1), to: labelOf(keys[(index + 1) % keys.length]!), kind: 'platform', rationale: 'by id' })),
        }))
        : [{ review: 'Two ideas.', groups: [{ group: 'platform/user', name: 'user-core', kind: 'module', rationale: 'a guess' }], moves: [] }];
      return {
        choices: answers.map((answer, index) => ({ index, finishReason: 'stop', value: request.parse(answer), reasoning: null })),
        usage: { promptTokens: 100, completionTokens: 10, reasoningTokens: 0 }, costUsd: 0.005, replayed: true, key: 'fake:by-id',
      };
    },
    spent: () => ({ run: 0, global: 0 }),
  };
}

/**
 * fakeGateway's answers with edit choices lost: the first run's three cut by the length cap (no edit is usable, so the
 * draft is its plan and the critic has nothing to review), the second's one cut and one unparseable, the third's none.
 */
function truncatingGateway(): Gateway {
  const answers = fakeGateway();
  const lost = [['length', 'length', 'length'], ['length', 'unparseable', null], [null, null, null]];
  let edits = 0;
  return {
    async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const result = await answers.structured(request);
      if (request.schemaName !== 'plan_edit') return result;
      const losses = lost[edits++]!;
      return {
        ...result,
        choices: result.choices.map((choice, index) => (losses[index] === 'length'
          ? { index, finishReason: 'length', error: 'truncated', reasoning: null }
          : losses[index] === 'unparseable' ? { index, finishReason: 'stop', error: 'content is not JSON: Unexpected end of JSON input', reasoning: null } : choice)),
      };
    },
    spent: () => ({ run: 0, global: 0 }),
  };
}

const missingGateway: Gateway = {
  structured: async () => {
    throw new GatewayError('replay miss: no ultra record in cassettes/none.jsonl', 'replay-miss');
  },
  spent: () => ({ run: 0, global: 0 }),
};

const manifest: BenchManifest = {
  entries: [
    { name: 'fixture', kind: 'scramble', repo, scramble: scrambleManifest, variant: 'default', cassette: 'cassettes/fixture.jsonl' },
    { name: 'fixture-real', kind: 'real', repo, sha: base, packageRoot: 'pkg', moduleRoot: 'src', cassette: 'cassettes/missing.jsonl' },
  ],
};

const optionsFor = (label: string, gateway: BenchOptions['gateway']): BenchOptions & { work: string } => ({
  only: null, gateway, certify: true, out: path.join(temporary, label, 'results'), work: path.join(temporary, label, 'work'), keep: false, mode: 'replay' as const, log: () => {},
});

describe('ac bench on a fixture', async () => {
  const gateway = fakeGateway();
  const options = optionsFor('first', (entry) => (entry.kind === 'scramble' ? gateway : missingGateway));
  const outcome = await runBench(manifest, options, { scramble: fakeScramble });
  const [scrambled, real] = outcome.results as [BenchResult, BenchResult];

  it('runs both entries, scrambling a worktree at the manifest commit on the bench branch, never the checkout', () => {
    expect(outcome.failures).toEqual([]);
    expect(scrambleCalls[0]).toMatchObject({ branch: 'ac-bench/fixture', environment: repo, certify: true, oracles: false, variant: 'default' });
    expect(scrambleCalls[0]!.repo).toBe(path.join(options.work, 'fixture', 'repo'));
    expect(git('rev-parse', 'HEAD')).toBe(base);
    expect(git('worktree', 'list')).not.toContain(options.work);
  });

  it('scores the scramble against its ground truth, with hard files judged on the original names', () => {
    expect(scrambled).toMatchObject({
      format: 'ac-bench/1', entry: 'fixture', kind: 'scramble', variant: 'default', sha: base, packageRoot: 'pkg', moduleRoot: 'src',
      featureFiles: 8, groundTruthModules: 2, hardFiles: 2,
      // The e2e test left in album/ is pinned in the facts: no method sees it, so it isn't leakage.
      leakyFiles: 0, leakage: { renamed: 0, inFeatureFolder: 0, underSubFolder: 0, subFolders: [], unseen: 1 },
      draft: { method: 'seeds draft (file names)', source: 'file names', contested: { fileNames: 2, exportNames: 2 } },
      scramble: { commit: scrambledCommit, moved: 8, declined: 0, excluded: 1, certificate: { verdict: 'pass', scope: 'static', failing: [] } },
    });
    const byMethod = new Map(scrambled.methods.map((score) => [score.method, score]));
    expect([...byMethod.keys()]).toEqual([
      'B0 type folders', 'name-token (full stem)', 'name-token (anchored)', 'export-token (anchored)', 'seeds draft (file names)', 'seeds draft (export names)',
      'Louvain r=1 (mean of seeds 1-5)', 'Louvain r=2 (mean of seeds 1-5)', 'Louvain r=4 (mean of seeds 1-5)', 'planner (Ultra)',
    ]);
    // Type folders cut across both features: no ground-truth module is recovered.
    expect(byMethod.get('B0 type folders')).toMatchObject({ kind: 'baseline', clusters: 4, c2cCvg: 0 });
    expect(byMethod.get('seeds draft (file names)')!.kind).toBe('draft');
    expect(byMethod.get('seeds draft (export names)')!.kind).toBe('baseline');
    expect(byMethod.get('planner (Ultra)')).toMatchObject({ kind: 'planner' });
    expect(byMethod.get('Louvain r=4 (mean of seeds 1-5)')!.note).toBe('mean of seeds 1-5');
    expect(Object.keys(scrambled.louvainMojoFmByResolution!)).toEqual(['1', '2', '4']);
    for (const score of scrambled.methods) expect(score.mojoFm).not.toBeNull();
    const best = scrambled.methods.filter((score) => score.kind !== 'planner').reduce((top, score) => (score.mojoFm! > top.mojoFm! ? score : top));
    expect(scrambled.bestBaseline).toEqual({ method: best.method, mojoFm: best.mojoFm, turboMq: best.turboMq.sum });
  });

  it('records the planner row: groups, plan sha256, the recorded cost, nothing spent, every call replayed', () => {
    expect(gateway.calls()).toBe(2);
    expect(scrambled.planner).toMatchObject({ cassette: 'cassettes/fixture.jsonl', recordedCostUsd: 0.01, spentUsd: 0, replayed: true, calls: { replayed: 2, recorded: 0 }, rules: 2, modules: 3 });
    expect(scrambled.planner!.planSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(scrambled.planner!.groups).toBe(scrambled.methods.at(-1)!.clusters);
  });

  it('says when the planner row is its draft: the edit kept every draft group as it was', () => {
    expect(scrambled.planner!.change).toEqual({
      draftGroups: 3, samePartition: true, filesMoved: 0, groupsMerged: 0,
      winner: { label: 'ultra#1', groupEntries: 3, moves: 0, movesById: 0, issues: {} }, critic: { suggestions: 0, kept: 0 },
    });
    expect(scrambled.methods.at(-1)).toMatchObject({ method: 'planner (Ultra)', note: "its draft's partition" });
    expect(scrambled.notes).toEqual([
      'The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 2 against 2 (no ground truth is read).',
      "The planner's plan keeps the partition of its draft, the seeds draft (file names): every file stays in its draft group, so the planner row scores the draft. "
        + 'The winning edit, ultra#1, had 3 group entries and 0 moves; the validator found no problem with it. The critic made no suggestion.',
      'Leakage, over the 9 movable files every method sees: 0 give their feature away in their path (0 still in a feature folder; 0 leaky renames; 0 in a sub-folder that only files of their feature share). '
        + '1 more leaky file is pinned or not read by the facts, so no method sees it: not counted.',
    ]);
  });

  it('scores a real entry without ground truth, and says when its planner is not recorded', () => {
    expect(real).toMatchObject({ kind: 'real', scramble: null, featureFiles: null, hardFiles: null, planner: null, louvainMojoFmByResolution: null });
    for (const score of real.methods) expect([score.mojoFm, score.ari, score.c2cCvg, score.clusterCountRatio, score.mojoFmHard]).toEqual([null, null, null, null, null]);
    const best = real.methods.reduce((top, score) => (score.turboMq.sum > top.turboMq.sum ? score : top));
    expect(real.bestBaseline!.turboMq).toBe(best.turboMq.sum);
    expect(real.notes!.join('\n')).toContain('not recorded in cassettes/missing.jsonl');
  });

  it('writes one JSON per entry and a summary with the best method and the planner bolded', () => {
    expect(fs.readdirSync(options.out).sort()).toEqual(['fixture-real.json', 'fixture.json', 'summary.md']);
    expect(JSON.parse(fs.readFileSync(path.join(options.out, 'fixture.json'), 'utf8'))).toEqual(scrambled);
    const summary = fs.readFileSync(path.join(options.out, 'summary.md'), 'utf8');
    expect(summary.indexOf('## fixture (scramble, default)')).toBeLessThan(summary.indexOf('## fixture-real (real)'));
    expect(summary).toContain('| method | clusters | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges |');
    expect(summary).toContain(`| **${scrambled.bestBaseline!.method}** |`);
    expect(summary).toContain("| **planner (Ultra) (its draft's partition)** |");
    expect(summary).toContain('Scored: 8 feature files in 2 modules (2 hard), of 9 movable files. 0 of the movable files give their feature away in their path (the leakage note below).');
    expect(summary).toContain('; 3 groups (3 modules), from the seeds draft (file names); planner rules 2; plan.yaml sha256 ');
    expect(summary).toContain('certificate PASS (static), digest `ffffffffffff`.');
  });

  it('writes the same bytes on a second run (the bench branch from the first run is replaced)', async () => {
    const again = optionsFor('second', (entry) => (entry.kind === 'scramble' ? fakeGateway() : missingGateway));
    const second = await runBench(manifest, again, { scramble: fakeScramble });
    expect(second.failures).toEqual([]);
    for (const file of ['fixture.json', 'fixture-real.json', 'summary.md']) {
      expect(fs.readFileSync(path.join(again.out, file), 'utf8'), file).toBe(fs.readFileSync(path.join(options.out, file), 'utf8'));
    }
  });

  /** The fixture entry under a profile that pins planner rules 1 (the S7 bench's), as a replay of its recording reads it. */
  const pinnedToRules1 = (): BenchManifest => {
    const profile = path.join(temporary, 'fixture-rules-1.json');
    fs.writeFileSync(profile, JSON.stringify({ name: 'fixture', packageRoot: 'pkg', node: 'system', plan: { moduleRoot: 'src', rules: 1 } }));
    return { entries: [{ ...manifest.entries[0]!, profile }] };
  };

  it('discloses a winning edit whose moves were all dropped and whose plan has no modules (ghostfolio, S7: planner rules 1)', async () => {
    const byId = { ...optionsFor('by-id', () => byIdGateway()), only: ['fixture'] };
    const [result] = (await runBench(pinnedToRules1(), byId, { scramble: fakeScramble })).results as [BenchResult];
    expect(result.planner).toMatchObject({ groups: 3, modules: 0, rules: 1, calls: { replayed: 2, recorded: 0 } });
    expect(result.planner!.change).toEqual({
      draftGroups: 3, samePartition: true, filesMoved: 0, groupsMerged: 0,
      winner: { label: 'ultra#1', groupEntries: 3, moves: 3, movesById: 3, issues: { 'unknown-file': 3 } }, critic: { suggestions: 1, kept: 0 },
    });
    expect(result.methods.at(-1)).toMatchObject({ method: 'planner (Ultra)', note: "its draft's partition; 0 modules" });
    expect(result.notes).toContain("The planner's plan keeps the partition of its draft, the seeds draft (file names): every file stays in its draft group, so the planner row scores the draft. "
      + 'The winning edit, ultra#1, had 3 group entries and 3 moves (3 name their file by its id, not its path); the validator found 3 problems with it (unknown-file 3) and dropped or repaired each before applying it. '
      + "Planner rules 1 read a move's file by its path only, so a move that names it by id is an unknown file. The critic made 1 suggestion and its gate kept none.");
    expect(result.notes).toContain('The plan has no feature modules: all 3 groups are platform or shared.');
    const summary = fs.readFileSync(path.join(byId.out, 'summary.md'), 'utf8');
    expect(summary).toContain('; 3 groups (0 modules), from the seeds draft (file names); planner rules 1; plan.yaml sha256 ');
    expect(summary).toContain('- Planner rules (src/planner/types.ts) say how the planner reads');
  });

  it('reads the same moves by their ids under planner rules 2, the default', async () => {
    const byId = { ...optionsFor('by-id-rules-2', () => byIdGateway()), only: ['fixture'] };
    const [result] = (await runBench(manifest, byId, { scramble: fakeScramble })).results as [BenchResult];
    expect(result.planner).toMatchObject({ modules: 0, rules: 2 });
    expect(result.planner!.change).toMatchObject({ samePartition: false, winner: { label: 'ultra#1', moves: 3, movesById: 3, issues: {} } });
    expect(result.notes!.join('\n')).toContain('had 3 group entries and 3 moves (3 name their file by its id, not its path); the validator found no problem with it. Planner rules 2 read a file by the id the prompt showed for it.');
  });

  it('records per run its edit choices, whether its plan came from an edit and whether the critic ran; a run with no usable edit delivers the draft', async () => {
    const truncated = { ...optionsFor('truncated', () => truncatingGateway()), only: ['fixture'], repeats: 3 };
    const [result] = (await runBench(manifest, truncated, { scramble: fakeScramble })).results as [BenchResult];
    expect(result.repeats!.runs.map((run) => [run.fromEdit, run.criticRan, run.editChoices, run.calls.replayed])).toEqual([
      [false, false, { asked: 3, returned: 3, parsed: 0, truncated: 3 }, 1],
      [true, true, { asked: 3, returned: 3, parsed: 1, truncated: 1 }, 2],
      [true, true, { asked: 3, returned: 3, parsed: 3, truncated: 0 }, 2],
    ]);
    // The validator accepts the draft run 1 delivered: it still counts in the mean as delivered, never as a plan of the model.
    expect(result.repeats!.runs.map((run) => run.valid)).toEqual([true, true, true]);
    expect(result.notes).toContain("Run 1 of 3: The planner's plan keeps the partition of its draft, the seeds draft (file names): every file stays in its draft group, so the planner row scores the draft. No edit came back, so the draft is the plan.");
    const summary = fs.readFileSync(path.join(truncated.out, 'summary.md'), 'utf8');
    expect(summary).toContain('| planner (Ultra) #1 | the seeds draft | 0 of 3 parsed (3 truncated) | no | yes |');
    expect(summary).toContain('1 of 3 runs had no usable edit, so the seeds draft became its plan; the critic reviewed 2 of 3 plans; 4 of 9 edit choices were cut by the length cap (finish_reason length). '
      + 'The validator accepts 2 of 3 plans, counting only plans that came from an edit.');
    const compared = compareReport(readComparedResults([truncated.out]));
    expect(compared).toMatch(/\n\| results \| `ultra` \| 3 \| [\d.]+ \([\d.]+ to [\d.]+\) \| \d of 3 \| 1 of 3 \| 4 of 9 \| 2 of 3 \| 2 of 3 \| /);
    expect(compared).toMatch(/\n\| results \| `ultra` \| 1 \| 3 \| \d of 3 \| 1 of 3 \| 4 of 9 \| 2 of 3 \| 2 of 3 \| /);
  });

  it('skips the planner row with --no-llm and keeps the worktree with --keep', async () => {
    const offline = { ...optionsFor('offline', null), only: ['fixture'], keep: true };
    const { results } = await runBench(manifest, offline, { scramble: fakeScramble });
    expect(results[0]!.planner).toBeNull();
    expect(results[0]!.methods.some((score) => score.kind === 'planner')).toBe(false);
    expect(results[0]!.notes).toContain('The planner did not run (--no-llm).');
    expect(fs.existsSync(path.join(offline.work, 'fixture', 'repo', 'pkg', 'src', 'services', 'avatar.service.ts'))).toBe(true);
    git('worktree', 'remove', '--force', path.join(offline.work, 'fixture', 'repo'));
  });
});

/**
 * Token Factory behind a fake transport: the first and third edit calls keep every draft group as it is, the second
 * merges album into user; the critic has nothing to say. Call c reports 100c prompt, 10c completion and 5c reasoning
 * tokens, so every run's tokens are its own.
 */
function fakeTokenFactory() {
  const bodies: RequestBody[] = [];
  let edits = 0;
  const send: Transport = async (body) => {
    bodies.push(body);
    const call = bodies.length;
    const { name, schema } = body.response_format.json_schema as unknown as { name: string; schema: { properties: { groups: { properties?: Record<string, unknown> } } } };
    const merged = name === 'plan_edit' && ++edits === 2;
    const answers = name === 'plan_edit'
      ? Array.from({ length: body.n ?? 1 }, () => ({
        groups: Object.fromEntries(Object.keys(schema.properties.groups.properties!).map((key) => {
          const label = key.slice(key.indexOf(':') + 1);
          return [key, label === 'shared' ? { name: 'shared', kind: 'shared' } : { name: merged && label === 'album' ? 'user' : label, kind: 'module' }];
        })),
        moves: [],
      }))
      : [{ review: 'The groups follow the features.', groups: [], moves: [] }];
    const choices = answers.map((answer, index) => ({ index, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer) } }));
    return { status: 200, headers: {}, bodyText: JSON.stringify({ choices, usage: { prompt_tokens: 100 * call, completion_tokens: 10 * call, completion_tokens_details: { reasoning_tokens: 5 * call } } }) };
  };
  return { send, bodies };
}

describe('ac bench --repeats, --planner and --cassette', async () => {
  const budget = path.join(temporary, 'budget');
  fs.mkdirSync(budget, { recursive: true });
  fs.writeFileSync(path.join(budget, 'runs.json'), JSON.stringify({ globalCap: 5, runs: { test: { cap: 2 } } }));
  /** The real gateway on the cassette the bench hands it (--cassette here), recording through `transport` when given. */
  const through = (mode: CassetteMode, transport?: Transport): BenchOptions['gateway'] => (entry) => createGateway({
    runId: 'test', mode, cassettePath: entry.cassette, ledgerPath: path.join(budget, 'ledger.jsonl'), runsPath: path.join(budget, 'runs.json'),
    ...(transport ? { transport, apiKey: 'test-key' } : {}),
  });
  const cassette = path.join(temporary, 'repeats.jsonl');
  const tokenFactory = fakeTokenFactory();
  const bench = async (label: string, gateway: BenchOptions['gateway'], extra: Partial<BenchOptions>) =>
    (await runBench(manifest, { ...optionsFor(label, gateway), only: ['fixture'], ...extra }, { scramble: fakeScramble })).results[0]!;
  const recorded = await bench('repeats-recorded', through('auto', tokenFactory.send), { mode: 'auto', cassette, repeats: 3 });
  const plannerRows = (result: BenchResult) => result.methods.filter((score) => score.kind === 'planner');

  it('runs the planner k times through one gateway: the cassette keys each repeated request by its occurrence', () => {
    const records = fs.readFileSync(cassette, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as CassetteRecord);
    const named = (name: string) => records.filter((record) => (record.request as RequestBody).response_format.json_schema.name === name);
    expect(tokenFactory.bodies).toHaveLength(6);
    expect(named('plan_edit').map((record) => record.occurrence)).toEqual([0, 1, 2]);
    expect(new Set(named('plan_edit').map((record) => record.hash)).size).toBe(1);
    // Runs 1 and 3 drew the same edit, so their reviews are one request, at occurrences 0 and 1.
    const reviews = named('plan_review');
    expect(reviews.map((record) => record.occurrence)).toEqual([0, 0, 1]);
    expect(reviews[2]!.hash).toBe(reviews[0]!.hash);
    expect(reviews[1]!.hash).not.toBe(reviews[0]!.hash);
  });

  it('keeps one planner row per run with its verdict, cost, calls and tokens, and the mean, min and max over them', () => {
    // The deterministic methods run once: the nine rows of a single run, then the planner's three.
    expect(recorded.methods.map((score) => score.method).slice(0, 9)).toEqual([
      'B0 type folders', 'name-token (full stem)', 'name-token (anchored)', 'export-token (anchored)', 'seeds draft (file names)', 'seeds draft (export names)',
      'Louvain r=1 (mean of seeds 1-5)', 'Louvain r=2 (mean of seeds 1-5)', 'Louvain r=4 (mean of seeds 1-5)',
    ]);
    const rows = plannerRows(recorded);
    expect(rows.map((score) => score.method)).toEqual(['planner (Ultra) #1', 'planner (Ultra) #2', 'planner (Ultra) #3']);
    const { runs, mean, min, max } = recorded.repeats!;
    // The default configuration goes unsaid, as in every result before S8b.
    expect(recorded.plannerConfiguration).toBeUndefined();
    expect(runs.map((run) => [run.repeat, run.method, run.valid, run.calls, run.tokens])).toEqual([
      [1, 'planner (Ultra) #1', true, { replayed: 0, recorded: 2 }, { prompt: 300, completion: 30, reasoning: 15 }],
      [2, 'planner (Ultra) #2', true, { replayed: 0, recorded: 2 }, { prompt: 700, completion: 70, reasoning: 35 }],
      [3, 'planner (Ultra) #3', true, { replayed: 0, recorded: 2 }, { prompt: 1100, completion: 110, reasoning: 55 }],
    ]);
    // Ultra's prices, $1 and $3 per million prompt and completion tokens; a recording run spends what it records.
    expect(runs.map((run) => [run.recordedCostUsd, run.spentUsd])).toEqual([[0.00039, 0.00039], [0.00091, 0.00091], [0.00143, 0.00143]]);
    expect(runs[2]!.planSha256).toBe(runs[0]!.planSha256);
    expect(runs[1]!.planSha256).not.toBe(runs[0]!.planSha256);
    expect([runs[0]!.groups, runs[1]!.groups]).toEqual([3, 2]);
    expect([mean.promptTokens, min.promptTokens, max.promptTokens, mean.recordedCostUsd, mean.groups, min.groups]).toEqual([700, 300, 1100, 0.00091, 2.7, 2]);
    const mojoFm = rows.map((score) => score.mojoFm!);
    expect([min.mojoFm, max.mojoFm, mean.mojoFm]).toEqual([Math.min(...mojoFm), Math.max(...mojoFm), Number((mojoFm.reduce((sum, value) => sum + value) / 3).toFixed(2))]);
    expect(min.mojoFm).not.toBe(max.mojoFm);
    // `planner` is the first run's, as a single run would write it.
    expect(recorded.planner).toMatchObject({ cassette, recordedCostUsd: 0.00039, calls: { replayed: 0, recorded: 2 }, planSha256: runs[0]!.planSha256 });
    expect(recorded.notes!.filter((note) => /^Run \d of 3: The planner's plan/.test(note))).toHaveLength(3);
    expect(recorded.notes!.filter((note) => note.startsWith('The planner starts from'))).toHaveLength(1);
  });

  it('says so in summary.md: the repeats note, the configuration, every run and the mean, min and max', () => {
    const summary = fs.readFileSync(path.join(temporary, 'repeats-recorded', 'results', 'summary.md'), 'utf8');
    expect(summary).toContain('With `--repeats k` the planner runs k times per entry through one gateway');
    expect(summary).toContain('- Planner configuration `ultra`: Nemotron 3 Ultra (medium_effort) edits and reviews; 3 runs through one gateway.');
    expect(summary).toContain('Planner runs (`ultra`):');
    expect(summary).toContain('- Planner, run 1 of 3 (the runs table has every run): recorded into ');
    expect(summary).toContain('| **planner (Ultra) #2** |');
    expect(summary).toContain(`| planner (Ultra) #2 | an edit | 3 of 3 parsed | yes | yes | 2 | 2 | $0.0009 | $0.0009 | 2 recorded | 700 | 70 | 35 | \`${recorded.repeats!.runs[1]!.planSha256.slice(0, 12)}\` |`);
    expect(summary).toContain('| min | ');
    expect(summary).toMatch(/\n\d of 3 runs score above the best deterministic method on MoJoFM, each run as delivered\. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 0 of 9 edit choices were cut by the length cap \(finish_reason length\)\. The validator accepts 3 of 3 plans, counting only plans that came from an edit\.\n/);
  });

  it('replays all k runs from the cassette and spends nothing; a replay asking for one run more fails closed', async () => {
    const replayed = await bench('repeats-replayed', through('replay'), { cassette, repeats: 3 });
    expect(replayed.methods).toEqual(recorded.methods);
    const recordedRuns = recorded.repeats!.runs.map(({ calls: _calls, spentUsd: _spent, ...run }) => run);
    expect(replayed.repeats!.runs.map(({ calls: _calls, spentUsd: _spent, ...run }) => run)).toEqual(recordedRuns);
    expect(replayed.repeats!.runs.map((run) => [run.calls, run.spentUsd])).toEqual(Array.from({ length: 3 }, () => [{ replayed: 2, recorded: 0 }, 0]));
    expect([replayed.repeats!.mean, replayed.repeats!.min, replayed.repeats!.max]).toEqual([recorded.repeats!.mean, recorded.repeats!.min, recorded.repeats!.max]);
    expect(tokenFactory.bodies).toHaveLength(6);

    const longer = await bench('repeats-longer', through('replay'), { cassette, repeats: 4 });
    expect([longer.planner, longer.repeats, plannerRows(longer)]).toEqual([null, undefined, []]);
    const missed = await bench('super-vl-missed', through('replay'), { cassette, planner: 'super-vl', repeats: 3 });
    // A configuration that recorded nothing still names itself, so compare can say whose row is missing.
    expect([missed.plannerConfiguration, missed.repeats, plannerRows(missed)]).toEqual(['super-vl', undefined, []]);
    expect(longer.notes).toContain(`The planner is not recorded in ${cassette} for these facts (replay miss on run 4 of 4); record it with --mode auto --run <budget run>.`);
  });

  const configurations: [PlannerConfigurationName, string, object | undefined][] = [
    ['super-vl', 'planner (Super VL, thinking on)', undefined],
    ['super-vl-low', 'planner (Super VL, low_effort)', { low_effort: true }],
    ['super-vl-direct', 'planner (Super VL, thinking off)', { enable_thinking: false }],
    ['ultra', 'planner (Ultra)', { medium_effort: true }],
  ];
  it.each(configurations)('asks the models of --planner %s, the edit and the critic alike', async (configuration, method, kwargs) => {
    const asked = fakeTokenFactory();
    const result = await bench(`planner-${configuration}`, through('auto', asked.send), { mode: 'auto', cassette: path.join(temporary, `${configuration}.jsonl`), planner: configuration });
    const { model } = plannerConfigurations[configuration].edit;
    expect(asked.bodies.map((body) => [body.response_format.json_schema.name, body.model, body.chat_template_kwargs, body.n, body.max_tokens])).toEqual([
      ['plan_edit', models[model].id, kwargs, 3, 64_000],
      ['plan_review', models[model].id, kwargs, undefined, 32_000],
    ]);
    expect(plannerRows(result).map((score) => score.method)).toEqual([method]);
    // One run of the default configuration writes neither its name nor a repeats block (a result as S8 wrote it); another configuration does.
    expect(result.plannerConfiguration).toBe(configuration === 'ultra' ? undefined : configuration);
    expect(result.repeats?.runs.length ?? 0).toBe(configuration === 'ultra' ? 0 : 1);
  });

  it("applies a profile's replay pins only to the recording they belong to: the entry's own cassette and the default configuration", async () => {
    const profile = path.join(temporary, 'pinned-profile.json');
    fs.writeFileSync(profile, JSON.stringify({ name: 'fixture', packageRoot: 'pkg', node: 'system', plan: { moduleRoot: 'src', rules: 1 } }));
    const pinned: BenchManifest = { entries: [{ ...manifest.entries[0]!, profile }] };
    const run = async (label: string, extra: Partial<BenchOptions>) =>
      (await runBench(pinned, { ...optionsFor(label, () => fakeGateway()), only: ['fixture'], ...extra }, { scramble: fakeScramble })).results[0]!.planner!;
    expect(await run('pins-own', {})).toMatchObject({ rules: 1, cassette: 'cassettes/fixture.jsonl' });
    expect(await run('pins-own-named', { cassette: 'cassettes/fixture.jsonl' })).toMatchObject({ rules: 1 });
    expect(await run('pins-other', { cassette: 'cassettes/experiment.jsonl' })).toMatchObject({ rules: 2, cassette: 'cassettes/experiment.jsonl' });
    expect(await run('pins-super-vl', { planner: 'super-vl' })).toMatchObject({ rules: 2 });
  });

  it('writes the same bytes with the defaults spelled out: --planner ultra --repeats 1 on the manifest cassette', async () => {
    const implicit = optionsFor('defaults-implicit', () => fakeGateway());
    const explicit = { ...optionsFor('defaults-explicit', () => fakeGateway()), planner: 'ultra' as const, repeats: 1, cassette: null };
    for (const options of [implicit, explicit]) expect((await runBench(manifest, options, { scramble: fakeScramble })).failures).toEqual([]);
    for (const file of ['fixture.json', 'fixture-real.json', 'summary.md']) {
      expect(fs.readFileSync(path.join(explicit.out, file), 'utf8'), file).toBe(fs.readFileSync(path.join(implicit.out, file), 'utf8'));
    }
    expect(fs.readFileSync(path.join(explicit.out, 'summary.md'), 'utf8')).not.toContain('--repeats');
  });
});

describe('ground truth', () => {
  const roleOf = (file: string) => (file.endsWith('.resolver.ts') ? 'resolver' : 'service');
  const factsAt = (paths: string[]): Facts => ({
    packageRoot: 'pkg', moduleRoot: 'src', sha: 'test', edges: [], pins: [],
    files: paths.map((file, index) => ({ path: file, id: index + 1, role: roleOf(file), loc: 1, exports: [], primaryExport: null, tables: { reads: [], writes: [] }, routes: [], tests: [] })),
  });
  const entity = (original: string, scrambled: string, truth: string): ScrambleEntity => ({ original, scrambled, truth, truthKind: 'feature', type: roleOf(original), typeVia: 'suffix', leaky: false });
  // user-history/user.resolver.ts collided with another feature's and was renamed from its export (UserHistoryUserResolver).
  const originals = ['src/user/avatar.service.ts', 'src/user-history/user-history.service.ts', 'src/user-history/user.resolver.ts', 'src/user/user.service.ts', 'src/user/gone.service.ts'];
  const defaults = ['src/services/avatar.service.ts', 'src/services/user-history.service.ts', 'src/resolvers/user-history-user.resolver.ts', 'src/services/user.service.ts', 'src/services/gone.service.ts'];
  const truths = ['user', 'user-history', 'user-history', 'user', 'user'];

  it('judges hard files on the default scramble\'s names, scores only files the facts can place, and counts the pinned ones', () => {
    const scramble = { entities: originals.map((original, index) => entity(original, defaults[index]!, truths[index]!)) } as ScrambleResult;
    const groundTruth = groundTruthOf(scramble, factsAt(defaults.slice(0, 4)));
    expect(groundTruth.featureFiles).toEqual(['src/resolvers/user-history-user.resolver.ts', 'src/services/avatar.service.ts', 'src/services/user-history.service.ts', 'src/services/user.service.ts']);
    // The renamed resolver names its feature now, so name-token gets it right: not hard (its original name `user` would be).
    expect(groundTruth.hardFiles).toEqual(['src/services/avatar.service.ts']);
    expect(groundTruth.pinnedFeatureFiles).toBe(1);
  });

  it('judges an H1 scramble on the default names it would have had, so both variants score the same files', () => {
    const opaque = ['src/services/s-1a2b.service.ts', 'src/services/s-3c4d.service.ts', 'src/resolvers/r-5e6f.resolver.ts', 'src/services/s-7a8b.service.ts', 'src/services/s-9c0d.service.ts'];
    const scramble = { entities: originals.map((original, index) => entity(original, opaque[index]!, truths[index]!)) } as ScrambleResult;
    const defaultPaths = new Map(originals.map((original, index) => [original, defaults[index]!]));
    expect(groundTruthOf(scramble, factsAt(opaque.slice(0, 4)), defaultPaths).hardFiles).toEqual(['src/services/s-1a2b.service.ts']);
    // Without the default names every opaque name is wrong.
    expect(groundTruthOf(scramble, factsAt(opaque.slice(0, 4))).hardFiles).toHaveLength(4);
  });
});

describe('leakage', () => {
  // ghostfolio's shapes: a sub-folder kept under the type folder, a declined file and pinned tests left in feature folders.
  const entity = (original: string, scrambled: string, truth: string, leaky = false): ScrambleEntity => ({ original, scrambled, truth, truthKind: 'feature', type: 'service', typeVia: 'suffix', leaky });
  const entities = [
    entity('src/app/portfolio/calculator/twr/twr.ts', 'src/app/services/calculator/twr/twr.ts', 'portfolio'),
    entity('src/app/portfolio/calculator/roi.ts', 'src/app/utils/calculator/roi.ts', 'portfolio'),
    entity('src/app/import/errors/import.error.ts', 'src/app/utils/errors/import.error.ts', 'import'),
    entity('src/app/portfolio/errors/portfolio.error.ts', 'src/app/utils/errors/portfolio.error.ts', 'portfolio'),
    entity('src/app/admin/queue/queue.service.ts', 'src/app/services/queue/queue.service.ts', 'admin', true),
    entity('src/app/admin/queue/jobs.ts', 'src/app/services/queue/jobs.ts', 'admin'),
    entity('src/app/admin/admin.service.ts', 'src/app/services/admin.admin.service.ts', 'admin', true),
    entity('src/app/user/user.service.ts', 'src/app/services/user.service.ts', 'user'),
    entity('src/app/user/hidden.service.ts', 'src/app/services/hidden.service.ts', 'user', true),
    entity('src/app/user/templates.ts', 'src/app/user/templates.ts', 'user'),
  ];
  const scramble = {
    manifest: { name: 'x', sha: 'x', packageRoot: 'apps/api', moduleRoot: 'src/app', shared: [], exclude: [] },
    entities,
    leakage: [
      { path: 'src/app/portfolio/calculator/roai/a.spec.ts', reason: 'test with no co-located subject' },
      { path: 'src/app/portfolio/calculator/roai/b.spec.ts', reason: 'test with no co-located subject' },
      { path: 'src/app/user/templates.ts', reason: 'declined by the executor (location-sensitive)' },
    ],
  } as unknown as ScrambleResult;
  // hidden.service.ts is pinned: only the other nine files reach the facts.
  const facts = { files: entities.filter((moved) => !moved.scrambled.includes('hidden')).map((moved) => ({ path: moved.scrambled })) } as Facts;

  it('counts only the files the facts show, and the sub-folders that group files of one feature', () => {
    const { leakage, files } = leakageOf(scramble, facts);
    // errors/ mixes two features, so a path groups nothing right there; calculator/ and queue/ hold one feature each.
    expect(leakage).toEqual({
      renamed: 2, inFeatureFolder: 1, underSubFolder: 4, unseen: 3,
      subFolders: [{ folder: 'calculator', files: 2, features: 1 }, { folder: 'errors', files: 2, features: 2 }, { folder: 'queue', files: 2, features: 1 }],
    });
    expect(files).toEqual([
      'src/app/services/admin.admin.service.ts', 'src/app/services/calculator/twr/twr.ts', 'src/app/services/queue/jobs.ts', 'src/app/services/queue/queue.service.ts',
      'src/app/user/templates.ts', 'src/app/utils/calculator/roi.ts',
    ]);
  });

  it('says it in plain words, a file counted under two kinds included', () => {
    const { leakage, files } = leakageOf(scramble, facts);
    expect(leakageNote(leakage, files.length, 9)).toBe('Leakage, over the 9 movable files every method sees: 6 give their feature away in their path '
      + '(1 still in a feature folder; 2 leaky renames; 4 in a sub-folder that only files of their feature share; 1 counted under two kinds). '
      + "Sub-folders kept under the type folders: calculator (2 files, 1 feature), errors (2 files, 2 features), queue (2 files, 1 feature); the planner's prompt shows them, and no deterministic method groups by them. "
      + '3 more leaky files are pinned or not read by the facts, so no method sees them: not counted.');
  });
});

describe('planner notes', () => {
  const draft = { method: 'seeds draft (file names)', source: 'file names' as const, contested: { fileNames: 10, exportNames: 12 } };

  it("says how far a plan moved from its draft (hoppscotch's recorded plan)", () => {
    const change = { draftGroups: 43, samePartition: false, filesMoved: 7, groupsMerged: 14, winner: { label: 'ultra#1', groupEntries: 43, moves: 7, issues: { 'foreign-name': 2 } }, critic: { suggestions: 9, kept: 8 } };
    expect(plannerNotes({ groups: 29, modules: 22, change, errors: [], rules: 2 }, draft, 186)).toEqual({
      notes: [
        'The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 12 against 10 (no ground truth is read).',
        "The planner's plan moves 7 of 186 files out of their draft group and merges 14 draft groups into others (43 draft groups, 29 plan groups). "
          + 'The winning edit, ultra#1, had 43 group entries and 7 moves; the validator found 2 problems with it (foreign-name 2) and dropped or repaired each before applying it. The critic made 9 suggestions and its gate kept 8.',
      ],
      rowNote: null,
    });
  });

  it('says what the rules did with moves that name their file by id: rules 1 dropped them (ghostfolio, S7), rules 2 read them', () => {
    const winner = { label: 'ultra#1', groupEntries: 44, moves: 154, movesById: 154, issues: { 'unknown-file': 154, 'banned-name': 1 } };
    const kept = { draftGroups: 44, samePartition: true, filesMoved: 0, groupsMerged: 0, winner, critic: { suggestions: 2, kept: 0 } };
    expect(plannerNotes({ groups: 44, modules: 0, change: kept, errors: [], rules: 1 }, draft, 154).notes.slice(1)).toEqual([
      "The planner's plan keeps the partition of its draft, the seeds draft (file names): every file stays in its draft group, so the planner row scores the draft. "
        + 'The winning edit, ultra#1, had 44 group entries and 154 moves (154 name their file by its id, not its path); the validator found 155 problems with it (unknown-file 154, banned-name 1) and dropped or repaired each before applying it. '
        + "Planner rules 1 read a move's file by its path only, so a move that names it by id is an unknown file. The critic made 2 suggestions and its gate kept none.",
      'The plan has no feature modules: all 44 groups are platform or shared.',
    ]);
    const read = { ...kept, samePartition: false, filesMoved: 20, groupsMerged: 4, winner: { ...winner, moves: 1, movesById: 1, issues: { 'banned-name': 1 } } };
    expect(plannerNotes({ groups: 40, modules: 30, change: read, errors: [], rules: 2 }, draft, 154).notes[1]).toContain(
      'had 44 group entries and 1 move (1 names its file by its id, not its path); the validator found 1 problem with it (banned-name 1) and dropped or repaired each before applying it. '
        + 'Planner rules 2 read a file by the id the prompt showed for it. The critic');
    // Results written before S8 carry no count: the sentence is the one they were written with.
    const before = { ...kept, winner: { label: 'ultra#2', groupEntries: 3, moves: 2, issues: {} } };
    expect(plannerNotes({ groups: 3, modules: 3, change: before, errors: [], rules: 1 }, draft, 9).notes[1]).toContain('had 3 group entries and 2 moves; the validator found no problem with it. The critic');
  });

  it('says when no edit came back, and keeps the invalid-plan note on the row', () => {
    const change = { draftGroups: 5, samePartition: true, filesMoved: 0, groupsMerged: 0, winner: null, critic: null };
    const { notes, rowNote } = plannerNotes({ groups: 5, modules: 4, change, errors: ['singleton-group: x'], rules: 2 }, draft, 20);
    expect(notes[1]).toBe("The planner's plan keeps the partition of its draft, the seeds draft (file names): every file stays in its draft group, so the planner row scores the draft. No edit came back, so the draft is the plan.");
    expect(rowNote).toBe("invalid plan: 1 validator error; its draft's partition");
  });
});

describe('the bench manifest and the command line', () => {
  it('reads the committed manifest: four scrambles and immich at the pinned commit', () => {
    const committed = readBenchManifest(path.join(import.meta.dirname, '..', '..', 'bench', 'manifest.json'));
    expect(committed.entries.map((entry) => `${entry.name}:${entry.kind}`)).toEqual(['hoppscotch:scramble', 'hoppscotch-H1:scramble', 'kaneo:scramble', 'ghostfolio:scramble', 'immich:real']);
    expect(committed.entries.find((entry) => entry.name === 'immich')).toMatchObject({ sha: '02063972e82b1bfd17b6fc2e3b3ff39936229ea5', cassette: 'cassettes/s6-immich.jsonl' });
  });

  it('rejects a manifest entry without its scramble manifest, and duplicate names', () => {
    const file = path.join(temporary, 'bad.json');
    fs.writeFileSync(file, JSON.stringify({ entries: [{ name: 'x', kind: 'scramble', repo, cassette: 'c.jsonl' }] }));
    expect(() => readBenchManifest(file)).toThrow('entry x needs a scramble manifest');
    fs.writeFileSync(file, JSON.stringify({ entries: [manifest.entries[1], manifest.entries[1]] }));
    expect(() => readBenchManifest(file)).toThrow('entry fixture-real twice');
  });

  it('refuses record mode without a budget run, an unknown mode and an unknown entry, before doing anything', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (message: string) => errors.push(message);
    try {
      const committed = path.join(import.meta.dirname, '..', '..', 'bench', 'manifest.json');
      expect(await benchCommand([committed, '--mode', 'record'])).toBe(2);
      expect(await benchCommand([committed, '--mode', 'live'])).toBe(2);
      expect(await benchCommand([committed, '--only', 'nope', '--work', path.join(temporary, 'unused')])).toBe(2);
      expect(await benchCommand([])).toBe(2);
      expect(await benchCommand([committed, '--planner', 'nano'])).toBe(2);
      for (const repeats of ['0', '1.5', 'three']) expect(await benchCommand([committed, '--repeats', repeats])).toBe(2);
    } finally {
      console.error = original;
    }
    expect(errors.join('\n')).toContain('--run <id from budget/runs.json> is required for record and auto modes');
    expect(errors.join('\n')).toContain('no bench entry nope');
    expect(errors.join('\n')).toContain('--planner is ultra, super-vl, super-vl-low, super-vl-direct, super-vl-long, super-vl-256k');
    expect(errors.join('\n')).toContain('--repeats takes a whole number from 1 up');
  });
});

// `ac bench` end to end on a small fixture repo: a feature-modular package (base commit) and its type-folder flattening
// (a second commit the fake scramble checks out, as scrambleRepo would leave the worktree), a real entry on the same
// base, the planner through fake gateways (an answer, a replay miss), the results JSON, summary.md, and determinism.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { benchCommand } from '../../src/bench/command.js';
import { groundTruthOf, readBenchManifest, runBench, type BenchOptions } from '../../src/bench/run.js';
import type { BenchManifest, BenchResult } from '../../src/bench/types.js';
import { GatewayError, type Gateway, type StructuredRequest, type StructuredResult } from '../../src/gateway/types.js';
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
    excluded: [{ path: 'src/main.ts', reason: 'outside the feature folders' }], declined: [], leakage: [],
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
  only: null, gateway, certify: true, out: path.join(temporary, label, 'results'), work: path.join(temporary, label, 'work'), keep: false, log: () => {},
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
      featureFiles: 8, groundTruthModules: 2, hardFiles: 2, leakyFiles: 0,
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

  it('records the planner row: groups, plan sha256, the recorded cost, nothing spent', () => {
    expect(gateway.calls()).toBe(2);
    expect(scrambled.planner).toMatchObject({ cassette: 'cassettes/fixture.jsonl', recordedCostUsd: 0.01, spentUsd: 0, replayed: true });
    expect(scrambled.planner!.planSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(scrambled.planner!.groups).toBe(scrambled.methods.at(-1)!.clusters);
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
    expect(summary).toMatch(/\| \*\*planner \(Ultra\)\*\* \|/);
    expect(summary).toContain('Scored: 8 feature files in 2 modules (2 hard), of ');
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
    } finally {
      console.error = original;
    }
    expect(errors.join('\n')).toContain('--run <id from budget/runs.json> is required for record and auto modes');
    expect(errors.join('\n')).toContain('no bench entry nope');
  });
});

// `ac bench <manifest>` and `ac bench compare <results-dir>...`: their own argument parser (contract S2), so the shared
// CLI parser stays untouched.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { packageDirectory } from '../certificate/toolchain.js';
import { createGateway } from '../gateway/gateway.js';
import type { CassetteMode } from '../gateway/types.js';
import { defaultPlannerConfiguration, isPlannerConfigurationName, plannerConfigurationNames } from '../planner/configurations.js';
import { compareReport, readComparedResults } from './compare.js';
import { keyScoresByMethod } from './partial-key.js';
import { packagePath, readBenchManifest, runBench } from './run.js';

export const benchUsage = `ac bench <manifest.json> [--only <entry,…>] [--mode replay|record|auto] [--run <budget run>] [--out bench/results]
           [--work <dir>] [--no-llm] [--no-certify] [--keep] [--planner ${plannerConfigurationNames.join('|')}] [--repeats 1]
           [--cassette <file.jsonl>]
           (the planner replays each entry's cassette by default and spends nothing; record and auto need --run;
           --no-llm skips the planner row; --keep keeps the worktrees under --work; --planner picks the models that
           edit and review (${defaultPlannerConfiguration} by default); --repeats k runs the planner k times per entry through one gateway;
           --cassette replaces every entry's cassette, and the profiles' replay pins then don't apply)
  ac bench compare <results-dir>... [--out <file.md>]
           (the planner's runs per entry and per results directory, one configuration each; stdout without --out)`;

/** `ac bench compare`: the report to --out or stdout. */
function compareCommand(argv: string[]): number {
  const fail = (message: string) => {
    console.error(`ac bench compare: ${message}\nusage: ${benchUsage}`);
    return 2;
  };
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: 'string' } } });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (!parsed.positionals.length) return fail('give one or more results directories');
  let report;
  try {
    report = compareReport(readComparedResults(parsed.positionals));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (parsed.values.out) {
    fs.mkdirSync(path.dirname(path.resolve(parsed.values.out)), { recursive: true });
    fs.writeFileSync(parsed.values.out, report);
    console.log(`compare: ${path.resolve(parsed.values.out)}`);
  } else {
    process.stdout.write(report);
  }
  return 0;
}

/** A --cassette as results name it: relative to this package when inside it (`cassettes/s8b-bench.jsonl`), else absolute. */
function cassetteName(file: string): string {
  const absolute = path.resolve(file);
  const relative = path.relative(packageDirectory(), absolute);
  return relative.startsWith('..') || path.isAbsolute(relative) ? absolute : relative.split(path.sep).join('/');
}

export async function benchCommand(argv: string[]): Promise<number> {
  if (argv[0] === 'compare') return compareCommand(argv.slice(1));
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        only: { type: 'string' },
        mode: { type: 'string', default: 'replay' },
        run: { type: 'string' },
        out: { type: 'string', default: path.join('bench', 'results') },
        work: { type: 'string' },
        'no-llm': { type: 'boolean', default: false },
        'no-certify': { type: 'boolean', default: false },
        keep: { type: 'boolean', default: false },
        planner: { type: 'string', default: defaultPlannerConfiguration },
        repeats: { type: 'string', default: '1' },
        cassette: { type: 'string' },
      },
    });
  } catch (error) {
    console.error(`ac bench: ${error instanceof Error ? error.message : String(error)}\nusage: ${benchUsage}`);
    return 2;
  }
  const { positionals, values } = parsed;
  const fail = (message: string) => {
    console.error(`ac bench: ${message}\nusage: ${benchUsage}`);
    return 2;
  };
  if (positionals.length !== 1) return fail('give one manifest file');
  const mode = values.mode as CassetteMode;
  if (!['replay', 'record', 'auto'].includes(mode)) return fail('--mode is replay, record or auto');
  if (mode !== 'replay' && !values.run) return fail('--run <id from budget/runs.json> is required for record and auto modes');
  const planner = values.planner;
  if (!isPlannerConfigurationName(planner)) return fail(`--planner is ${plannerConfigurationNames.join(', ')}`);
  const repeats = Number(values.repeats);
  if (!(Number.isInteger(repeats) && repeats >= 1)) return fail('--repeats takes a whole number from 1 up');

  let manifest;
  try {
    manifest = readBenchManifest(positionals[0]!);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const log = (message: string) => process.stderr.write(`[bench] ${message}\n`);
  const out = path.resolve(values.out);
  const runId = values.run ?? 'replay';
  let outcome;
  try {
    outcome = await runBench(manifest, {
      only: values.only ? values.only.split(',').map((name) => name.trim()).filter(Boolean) : null,
      gateway: values['no-llm'] ? null : (entry) => createGateway({ runId, mode, cassettePath: packagePath(entry.cassette) }),
      certify: !values['no-certify'],
      out,
      work: values.work ?? null,
      keep: values.keep,
      mode,
      planner,
      repeats,
      cassette: values.cassette ? cassetteName(values.cassette) : null,
      log,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  for (const result of outcome.results) {
    const best = result.bestBaseline;
    const rows = result.methods.filter((score) => score.kind === 'planner');
    const value = (mojoFm: number | null, turboMq: number) => (result.kind === 'scramble' ? `MoJoFM ${mojoFm}` : `TurboMQ ${turboMq.toFixed(2)}`);
    const planner = rows.length ? rows.map((score) => value(score.mojoFm, score.turboMq.sum)).join(', ') : 'no row';
    const key = result.partialKey;
    const onKey = key ? (() => {
      const scores = keyScoresByMethod(key);
      const planners = rows.length ? rows.map((score) => `MoJoFM ${scores.get(score.method)?.mojoFm}`).join(', ') : 'no row';
      return `; over the key's ${key.scoredFiles} files: best deterministic ${key.bestBaseline ? `${key.bestBaseline.method} MoJoFM ${key.bestBaseline.mojoFm}` : 'none'}, planner ${planners}`;
    })() : '';
    console.log(`${result.entry}: best deterministic ${best ? `${best.method} ${value(best.mojoFm, best.turboMq)}` : 'none'}; planner ${rows.length > 1 ? `(${rows.length} runs) ` : ''}${planner}${onKey}`);
  }
  for (const failure of outcome.failures) console.error(`${failure.entry}: FAILED: ${failure.error.split('\n')[0]}`);
  console.log(`results: ${out} (summary.md); work: ${outcome.work}`);
  return outcome.failures.length ? 1 : 0;
}

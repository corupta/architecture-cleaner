// `ac bench <manifest>`: its own argument parser (contract S2), so the shared CLI parser stays untouched.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createGateway } from '../gateway/gateway.js';
import type { CassetteMode } from '../gateway/types.js';
import { packagePath, readBenchManifest, runBench } from './run.js';

export const benchUsage = `ac bench <manifest.json> [--only <entry,…>] [--mode replay|record|auto] [--run <budget run>] [--out bench/results]
           [--work <dir>] [--no-llm] [--no-certify] [--keep]
           (the planner replays each entry's cassette by default and spends nothing; record and auto need --run;
           --no-llm skips the planner row; --keep keeps the worktrees under --work)`;

export async function benchCommand(argv: string[]): Promise<number> {
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
      log,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  for (const result of outcome.results) {
    const best = result.bestBaseline;
    const planner = result.methods.find((score) => score.kind === 'planner');
    const value = (mojoFm: number | null, turboMq: number) => (result.kind === 'scramble' ? `MoJoFM ${mojoFm}` : `TurboMQ ${turboMq.toFixed(2)}`);
    console.log(`${result.entry}: best deterministic ${best ? `${best.method} ${value(best.mojoFm, best.turboMq)}` : 'none'}; planner ${planner ? value(planner.mojoFm, planner.turboMq.sum) : 'no row'}`);
  }
  for (const failure of outcome.failures) console.error(`${failure.entry}: FAILED: ${failure.error.split('\n')[0]}`);
  console.log(`results: ${out} (summary.md); work: ${outcome.work}`);
  return outcome.failures.length ? 1 : 0;
}

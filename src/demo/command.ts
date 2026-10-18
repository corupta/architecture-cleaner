// `ac demo [--replay|--live|--full]`: the judges' path. --replay (the default) reproduces the recorded immich run from
// the committed cassette with no key and no spend; --live plans immich afresh with Nemotron on the caller's own Token
// Factory key; --full runs the whole ladder with `ac run`. Each writes <work>/demo.md and <work>/demo.json.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fullDemo } from './full.js';
import { liveDemo, liveKey } from './live.js';
import { demoMarkdown, differences, type DemoReport } from './report.js';
import { replayDemo } from './replay.js';
import { immichDemo } from './target.js';

export const demoUsage = `ac demo [--replay | --live | --full] [--work <dir>] [--repo <immich clone>] [--env <checkout with node_modules>]
          [--steps <n>|all] [--sample <k>|all] [--oracles]
          (--replay, the default: no key, $0: the recorded immich plan replayed from cassettes/s6-immich.jsonl, every step
          executed again and its tree compared with runs/immich-ladder, a sample certified again, the findings replayed;
          --live: a new plan from Nemotron on the NEBIUS_API_KEY in your environment, about $0.20 (no .env is read);
          --full: \`ac run\` end to end, about 2 h)`;

/** --steps and --sample: a whole number, or `all`. */
function count(value: string | undefined, flag: string): number | 'all' | undefined {
  if (value === undefined) return undefined;
  if (value === 'all') return 'all';
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} takes a whole number or all`);
  return parsed;
}

function finish(report: DemoReport): number {
  fs.writeFileSync(path.join(report.workDir, 'demo.json'), `${JSON.stringify(report, null, 1)}\n`);
  const markdown = demoMarkdown(report);
  fs.writeFileSync(path.join(report.workDir, 'demo.md'), markdown);
  console.log(markdown);
  console.log(`written: ${path.join(report.workDir, 'demo.md')} (and demo.json)`);
  return differences(report).length ? 1 : 0;
}

export async function demoCommand(argv: string[]): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        replay: { type: 'boolean', default: false },
        live: { type: 'boolean', default: false },
        full: { type: 'boolean', default: false },
        work: { type: 'string' },
        repo: { type: 'string' },
        env: { type: 'string' },
        steps: { type: 'string' },
        sample: { type: 'string' },
        oracles: { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    console.error(`ac demo: ${(error as Error).message}\n${demoUsage}`);
    return 2;
  }
  const log = (message: string) => process.stderr.write(`[demo] ${message}\n`);
  const modes = [values.replay, values.live, values.full].filter(Boolean).length;
  if (modes > 1) {
    console.error(`ac demo: pick one of --replay, --live and --full\n${demoUsage}`);
    return 2;
  }
  let steps;
  let sample;
  try {
    steps = count(values.steps, '--steps');
    sample = count(values.sample, '--sample');
  } catch (error) {
    console.error(`ac demo: ${(error as Error).message}`);
    return 2;
  }
  if (values.oracles && !values.env) {
    console.error('ac demo: --oracles needs --env <immich checkout with node_modules> (the oracles run the target\'s own tools)');
    return 2;
  }
  const target = immichDemo();
  const workDir = path.resolve(values.work ?? 'ac-demo');
  // The certifier's commit-keyed oracle cache (used by `ac run`'s baseline) defaults to a directory in the home
  // directory: the demo keeps it in its work dir unless the caller chose one.
  process.env.AC_ORACLE_CACHE ??= path.join(workDir, 'oracle-cache');
  const common = {
    target, workDir, ...(values.repo ? { repo: values.repo } : {}), environment: values.env ?? null,
    steps: steps === undefined || steps === 'all' ? null : steps, sample: sample ?? 3, oracles: values.oracles, log,
  };
  try {
    if (values.live) {
      // Refuse before anything is fetched: live mode spends only a key the caller put in the environment for it.
      const key = liveKey();
      if (!key) {
        console.error('ac demo --live needs your own Token Factory key in the environment: `NEBIUS_API_KEY=<your key> npx ac demo --live`. '
          + 'It reads no .env file. Without a key, `ac demo --replay` reproduces the recorded run for $0.');
        return 2;
      }
      return finish((await liveDemo({ ...common, key })).report);
    }
    if (values.full) {
      if (!values.env) {
        console.error('ac demo --full needs --env <immich checkout with node_modules>: `ac run` runs the baseline and the oracles');
        return 2;
      }
      return finish((await fullDemo({ ...common, environment: values.env })).report);
    }
    return finish((await replayDemo(common)).report);
  } catch (error) {
    console.error(`ac demo: ${(error as Error).message}`);
    return 2;
  }
}

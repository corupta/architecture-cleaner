// `ac findings <run-dir> [--repo <path>] [--env <checkout>] [--cassette <file.jsonl>] [--mode replay|record|auto]
// [--run <budget run>] [--no-narration]`: the findings log of a run, written to <run-dir>/findings/, and report.md's
// "## Findings" section re-rendered from it. Narration replays from the cassette by default and spends nothing.
import fs from 'node:fs';
import path from 'node:path';
import { packageDirectory } from '../certificate/toolchain.js';
import { createGateway } from '../gateway/gateway.js';
import type { CassetteMode } from '../gateway/types.js';
import { readRunState } from '../orchestrator/run-directory.js';
import { renderReport } from '../orchestrator/report.js';
import { runFindings } from './index.js';

export interface FindingsFlags {
  repo?: string;
  env?: string;
  cassette?: string;
  mode?: string;
  run?: string;
  'no-narration': boolean;
}

export const findingsUsage = `ac findings <run-dir> [--repo <clone with the base commit>] [--env <checkout with node_modules>]
            [--cassette <file.jsonl>] [--mode replay|record|auto] [--run <budget run>] [--no-narration]
            (narration replays by default; record and auto need --run; without --cassette or --run it is off)`;

export async function findingsCommand(runDirectory: string, flags: FindingsFlags): Promise<number> {
  const mode = (flags.mode ?? 'replay') as CassetteMode;
  if (!['replay', 'record', 'auto'].includes(mode)) {
    console.error(findingsUsage);
    return 2;
  }
  if (mode !== 'replay' && !flags.run) {
    console.error('--run <id from budget/runs.json> is required for record and auto modes');
    return 2;
  }
  const root = path.resolve(runDirectory);
  if (!fs.existsSync(path.join(root, 'run.json'))) {
    console.error(`no run.json in ${root}`);
    return 2;
  }
  const narrate = !flags['no-narration'] && Boolean(flags.cassette ?? flags.run);
  const gateway = narrate
    ? createGateway({ runId: flags.run ?? 'replay', mode, cassettePath: path.resolve(flags.cassette ?? path.join(packageDirectory(), 'cassettes', `${flags.run}.jsonl`)) })
    : null;
  const log = (message: string) => process.stderr.write(`[findings] ${message}\n`);
  if (!narrate && !flags['no-narration']) log('narration off: no --cassette or --run');
  const result = await runFindings({ runDirectory: root, ...(flags.repo ? { repo: flags.repo } : {}), ...(flags.env ? { environment: flags.env } : {}), gateway, log });
  const state = readRunState(root);
  const { narration } = result.document;
  fs.writeFileSync(path.join(root, 'report.md'), renderReport(state, {
    findings: () => result.reportSection,
    narration: narration && { costUsd: narration.costUsd, calls: narration.calls, replayed: narration.replayed },
  }));
  const { document } = result;
  const byKind = new Map<string, number>();
  for (const finding of document.findings) byKind.set(finding.kind, (byKind.get(finding.kind) ?? 0) + 1);
  console.log(`${document.findings.length} findings → ${result.written.map((file) => path.join(root, file)).join(', ')}; report.md updated`);
  for (const [kind, count] of byKind) console.log(`  ${kind}: ${count}`);
  for (const source of document.sources) console.log(`  source ${source.name}: ${source.detail}`);
  if (document.narration) {
    const record = document.narration;
    console.log(`  narration: ${record.narrated} narrated, ${record.dropped.length} dropped, ${record.calls} calls, $${record.costUsd.toFixed(4)}${record.replayed ? ' (replayed)' : ''}${record.error ? `; stopped: ${record.error}` : ''}`);
  }
  return 0;
}

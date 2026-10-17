// `ac site --out <dir> [--source-url <url>]`: the replay site, built from this package's committed artifacts.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { packageDirectory } from '../certificate/toolchain.js';
import { buildSite } from './build.js';

export const siteUsage = `ac site --out <dir> [--source-url <repository URL>]
         (the replay site from runs/, runs/g3, bench/results and the budget ledger: offline, deterministic, GitHub Pages ready)`;

export async function siteCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: false, options: { out: { type: 'string' }, 'source-url': { type: 'string' } } });
  } catch (error) {
    console.error(`ac site: ${error instanceof Error ? error.message : String(error)}\n${siteUsage}`);
    return 2;
  }
  if (!parsed.values.out) {
    console.error(`usage: ${siteUsage}`);
    return 2;
  }
  try {
    const result = buildSite({
      packageDirectory: packageDirectory(),
      out: parsed.values.out,
      sourceUrl: parsed.values['source-url'] ?? null,
      log: (message) => process.stderr.write(`[site] ${message}\n`),
    });
    console.log(`site: ${path.join(result.out, 'index.html')} (${result.files.length} files, ${(result.bytes / 1e6).toFixed(2)} MB; runs: ${result.runs.map((run) => `${run.name}${run.graph === 'missing' ? ' (no module graph)' : ''}`).join(', ') || 'none'})`);
    return 0;
  } catch (error) {
    console.error(`ac site: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

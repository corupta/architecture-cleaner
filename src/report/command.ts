// `ac report <run-dir> --out <dir> [--repo <checkout>] [--regraph]`: the run's static HTML bundle (plan §4 "Outputs").
import path from 'node:path';
import { parseArgs } from 'node:util';
import { packageDirectory } from '../certificate/toolchain.js';
import { writeReport } from './bundle.js';

export const reportUsage = `ac report <run-dir> --out <dir> [--repo <clone with the run's commits>] [--regraph]
           (a static HTML bundle; graph.json is computed once from the repo, then read from the run dir offline)`;

export async function reportCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: 'string' }, repo: { type: 'string' }, regraph: { type: 'boolean', default: false } } });
  } catch (error) {
    console.error(`ac report: ${error instanceof Error ? error.message : String(error)}\n${reportUsage}`);
    return 2;
  }
  const [runDirectory] = parsed.positionals;
  if (!runDirectory || !parsed.values.out || parsed.positionals.length > 1) {
    console.error(`usage: ${reportUsage}`);
    return 2;
  }
  try {
    const result = writeReport({
      runDirectory,
      out: parsed.values.out,
      ...(parsed.values.repo ? { repo: parsed.values.repo } : {}),
      regraph: parsed.values.regraph,
      packageDirectory: packageDirectory(),
      log: (message) => process.stderr.write(`[report] ${message}\n`),
    });
    console.log(`report: ${path.join(result.out, 'index.html')} (${result.files.length} files, ${(result.bytes / 1e6).toFixed(2)} MB; module graph ${result.graph})`);
    return 0;
  } catch (error) {
    console.error(`ac report: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

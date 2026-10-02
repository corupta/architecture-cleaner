#!/usr/bin/env node
// `ac` CLI. S3 surface: `ac analyze <repo>` and `ac move <repo> --map <pathmap.json> [--dry-run]`.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { analyzeRepo } from '../analyzer/analyze.js';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import { executeMove } from '../executor/execute.js';

const usage = `usage:
  ac analyze <repo> [--json]
  ac move <repo> --map <pathmap.json> [--dry-run] [--json]`;

function analyzeCommand(repoPath: string, json: boolean) {
  const analysis = analyzeRepo(gitRepoFs(repoPath));
  const counts: Record<string, number> = {};
  let hazards = 0;
  for (const file of analysis.files.values()) {
    hazards += file.hazards.length;
    for (const site of file.sites) counts[`${site.kind}:${site.resolution.type}`] = (counts[`${site.kind}:${site.resolution.type}`] ?? 0) + 1;
  }
  if (json) console.log(JSON.stringify({ files: [...analysis.files.values()] }, null, 1));
  else console.log(JSON.stringify({ files: analysis.files.size, hazards, sites: counts }, null, 1));
}

function moveCommand(repoPath: string, mapFile: string, dryRun: boolean, json: boolean): number {
  const pathMap = JSON.parse(fs.readFileSync(mapFile, 'utf8')) as { moves: Record<string, string> };
  const result = executeMove(gitRepoFs(repoPath), new Map(Object.entries(pathMap.moves)), { dryRun });
  if (json) {
    console.log(JSON.stringify({ ...result, moves: Object.fromEntries(result.moves), before: undefined, after: undefined }, null, 1));
  } else {
    console.log(`${result.outcome}: ${result.moves.size} files`);
    if (result.outcome === 'declined') for (const decline of result.declines) console.log(`  ${decline.code} ${decline.file}: ${decline.detail}`);
    else if (result.outcome === 'unverified') for (const violation of result.violations) console.log(`  ${violation.file}: ${violation.detail}`);
    else console.log(`  ${result.edits.length} specifier edits in ${new Set(result.edits.map((edit) => edit.file)).size} files`);
  }
  return result.outcome === 'applied' || result.outcome === 'verified' ? 0 : 1;
}

function main(argv: string[]): number {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { map: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, json: { type: 'boolean', default: false } },
  });
  const [command, repo] = positionals;
  if (command === 'analyze' && repo) {
    analyzeCommand(repo, values.json);
    return 0;
  }
  if (command === 'move' && repo && values.map) return moveCommand(repo, values.map, values['dry-run'], values.json);
  console.error(usage);
  return 2;
}

process.exitCode = main(process.argv.slice(2));

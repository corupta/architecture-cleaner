#!/usr/bin/env node
// `ac` CLI: `ac analyze <repo>`, `ac move <repo> --map <pathmap.json> [--dry-run]`, `ac certify <repo> <base>..<head>`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeRepo } from '../analyzer/analyze.js';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import { certify } from '../certificate/certify.js';
import { loadProfile } from '../certificate/profile.js';
import { summarize, trailers } from '../certificate/report.js';
import type { CheckId } from '../certificate/types.js';
import { executeMove } from '../executor/execute.js';

const usage = `usage:
  ac analyze <repo> [--json]
  ac move <repo> --map <pathmap.json> [--dry-run] [--json]
  ac certify <repo> <base>..<head> [--profile <name|file>] [--oracles] [--root <package-dir>] [--env <checkout>]
             [--only K1,K2,...] [--out <certificate.json>] [--work-dir <dir>] [--keep] [--json]`;

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

interface CertifyFlags {
  root?: string;
  env?: string;
  profile?: string;
  oracles: boolean;
  only?: string;
  out?: string;
  'work-dir'?: string;
  keep: boolean;
  json: boolean;
}

async function certifyCommand(repo: string, range: string, flags: CertifyFlags): Promise<number> {
  const [base, head] = range.split('..');
  if (!base || !head) {
    console.error(usage);
    return 2;
  }
  const profile = flags.profile ? loadProfile(flags.profile) : null;
  if (flags.oracles && !profile?.oracles?.length) {
    console.error('--oracles needs a --profile with oracle commands');
    return 2;
  }
  const certificate = await certify({
    repo,
    base,
    head,
    packageRoot: (flags.root ?? profile?.packageRoot ?? '').replace(/^\.\/?/, '').replace(/\/$/, ''),
    environment: flags.env ?? repo,
    profile,
    oracles: flags.oracles,
    ...(flags.only ? { only: flags.only.split(',').map((id) => id.trim()) as CheckId[] } : {}),
    workDir: flags['work-dir'] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ac-certify-')),
    keep: flags.keep,
  });
  if (flags.out) fs.writeFileSync(flags.out, `${JSON.stringify(certificate, null, 1)}\n`);
  if (flags.json) console.log(JSON.stringify(certificate, null, 1));
  else console.log(`${summarize(certificate)}\n\n${trailers(certificate).join('\n')}`);
  return certificate.verdict === 'pass' ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      map: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      root: { type: 'string' },
      env: { type: 'string' },
      profile: { type: 'string' },
      oracles: { type: 'boolean', default: false },
      only: { type: 'string' },
      out: { type: 'string' },
      'work-dir': { type: 'string' },
      keep: { type: 'boolean', default: false },
    },
  });
  const [command, repo, range] = positionals;
  if (command === 'analyze' && repo) {
    analyzeCommand(repo, values.json);
    return 0;
  }
  if (command === 'move' && repo && values.map) return moveCommand(repo, values.map, values['dry-run'], values.json);
  if (command === 'certify' && repo && range) return certifyCommand(repo, range, values);
  console.error(usage);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));

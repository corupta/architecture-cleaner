// `ac scramble <repo> --manifest <file>`: its own argument parser (the shared one in src/cli/main.ts stays strict).
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadProfile } from '../certificate/profile.js';
import { readScrambleManifest, scrambleRepo } from './index.js';
import type { ScrambleVariant } from './types.js';

export const scrambleUsage = `ac scramble <repo> --manifest <bench/scramble/x.json> [--variant default|H1] [--out <dir>] [--branch <name>]
              [--profile <name|file>] [--env <checkout>] [--oracles] [--no-certify]
              (<repo>: a worktree at the manifest's sha that may be written to; commits on ac-scramble/<name>[-H1])`;

export async function scrambleCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        manifest: { type: 'string' },
        variant: { type: 'string', default: 'default' },
        out: { type: 'string' },
        branch: { type: 'string' },
        profile: { type: 'string' },
        env: { type: 'string' },
        oracles: { type: 'boolean', default: false },
        'no-certify': { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    console.error(`ac scramble: ${(error as Error).message}\nusage: ${scrambleUsage}`);
    return 2;
  }
  const { positionals, values } = parsed;
  const [repo] = positionals;
  if (!repo || positionals.length > 1 || !values.manifest) {
    console.error(`usage: ${scrambleUsage}`);
    return 2;
  }
  if (values.variant !== 'default' && values.variant !== 'H1') {
    console.error('ac scramble: --variant is default or H1');
    return 2;
  }
  if (values.oracles && (!values.profile || values['no-certify'])) {
    console.error('ac scramble: --oracles needs --profile and a certificate (drop --no-certify)');
    return 2;
  }
  try {
    const manifest = readScrambleManifest(values.manifest);
    const variant = values.variant as ScrambleVariant;
    const out = values.out ?? path.join('ac-scrambles', `${manifest.name}${variant === 'H1' ? '-H1' : ''}`);
    const result = await scrambleRepo({
      repo,
      manifest,
      variant,
      out,
      ...(values.branch ? { branch: values.branch } : {}),
      ...(values.env ? { environment: values.env } : {}),
      profile: values.profile ? loadProfile(values.profile) : null,
      certify: !values['no-certify'],
      oracles: values.oracles,
      log: (message) => process.stderr.write(`[scramble] ${message}\n`),
    });
    const moved = result.entities.filter((entity) => entity.scrambled !== entity.original).length;
    const features = new Set(result.entities.filter((entity) => entity.truthKind === 'feature').map((entity) => entity.truth)).size;
    console.log(`${result.manifest.name}${variant === 'H1' ? ' (H1)' : ''}: ${moved} of ${result.entities.length} scored files moved out of ${features} feature folders, `
      + `${result.declined.length} declined, ${result.leakage.length} files left in feature folders, ${result.entities.filter((entity) => entity.leaky).length} leaky renames`);
    console.log(`commit ${result.commit.slice(0, 12)} on ${result.branch} in ${result.worktree}`);
    if (result.certificate) console.log(`certificate: ${result.certificate.verdict.toUpperCase()} (${result.certificate.scope})${result.certificate.failing.length ? `, failing ${result.certificate.failing.join(' ')}` : ''}`);
    console.log(`→ ${path.resolve(out)}`);
    return result.certificate && result.certificate.verdict !== 'pass' ? 1 : 0;
  } catch (error) {
    console.error(`ac scramble: ${(error as Error).message}`);
    return 2;
  }
}

// `ac rewrap <repo> <base>..<head> --env <checkout>`: the re-wrap (rewrap.ts) as one commit on top of <head>, on a
// branch it makes (the checkout's current branch only when named and clean at <head>); prints what it re-wrapped and
// what it skipped, with the reasons. Certify it with `ac certify <repo> <head>..<commit>`: K2 checks it is layout only.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { branchMode, commitOnto, placeBranch, resolveCommit, topLevelOf } from './commit.js';
import { planRewrap, type RewrapPlan, rewrapSubject, rewrapSummary } from './rewrap.js';

export const rewrapUsage = `ac rewrap <repo> <base>..<head> --env <checkout with node_modules> [--root <package-dir>] [--branch <name>]
            (re-wraps the import lines the moves lengthened with the target's prettier; one commit on top of <head>, on
            a new branch, ac/rewrap-<head> by default)`;

/** The commit message: a conventional subject, what was re-wrapped and from which range. */
export function rewrapMessage(scope: string, plan: RewrapPlan, base: string, head: string): string {
  return `${rewrapSubject(scope)}\n\n${rewrapSummary(plan)}.\nTouched declarations of ${base.slice(0, 12)}..${head.slice(0, 12)} whose base counterparts were prettier-formatted; every other byte identical.\n`;
}

/** The commit scope: the package root given, else the one package every re-wrapped file sits in, else the repo's name. */
function scopeOf(repo: string, root: string, plan: RewrapPlan): string {
  if (root) return root;
  const tops = new Set([...plan.files.keys()].map((file) => file.split('/')[0]!));
  return tops.size === 1 && [...plan.files.keys()].every((file) => file.includes('/')) ? [...tops][0]! : path.basename(path.resolve(repo));
}

export async function rewrapCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { env: { type: 'string' }, root: { type: 'string' }, branch: { type: 'string' } } });
  } catch (error) {
    console.error(`ac rewrap: ${(error as Error).message}\nusage: ${rewrapUsage}`);
    return 2;
  }
  const { positionals, values } = parsed;
  const [given, range] = positionals;
  const [baseRevision, headRevision] = range?.split('..') ?? [];
  if (!given || !baseRevision || !headRevision || positionals.length > 2 || !values.env) {
    console.error(`usage: ${rewrapUsage}`);
    return 2;
  }
  const root = (values.root ?? '').replace(/^\.\/?/, '').replace(/\/$/, '');
  try {
    // A package directory names its repository: every path below is the repository's.
    const repo = topLevelOf(given);
    const base = resolveCommit(repo, baseRevision);
    const head = resolveCommit(repo, headRevision);
    const branch = values.branch ?? `ac/rewrap-${head.slice(0, 10)}`;
    const mode = branchMode(repo, branch, head);
    const plan = await planRewrap({ repo, base, head, checkout: repo, environment: values.env, packageRoot: root });
    for (const declaration of plan.declarations) console.log(`  re-wrapped ${declaration.file}:${declaration.line}  ${declaration.before.split('\n')[0]!.slice(0, 100)}`);
    for (const skip of plan.skips) console.log(`  skipped ${skip.file}${skip.line ? `:${skip.line}` : ''}: ${skip.reason}`);
    console.log(`${rewrapSummary(plan)}; ${plan.examined} changed source files examined, ${plan.skips.length} skips`);
    if (!plan.files.size) {
      console.log('nothing to re-wrap: no commit made');
      return 0;
    }
    const commit = commitOnto(repo, head, plan.files, rewrapMessage(scopeOf(repo, root, plan), plan, base, head));
    placeBranch(repo, branch, commit, mode);
    console.log(`commit ${commit} on ${branch} (${mode === 'create' ? 'a new branch' : 'moved forward'}), parent ${head.slice(0, 12)}`);
    console.log(`certify it: ac certify ${repo} ${head.slice(0, 12)}..${commit.slice(0, 12)} --env ${values.env}`);
    return 0;
  } catch (error) {
    console.error(`ac rewrap: ${(error as Error).message}`);
    return 2;
  }
}

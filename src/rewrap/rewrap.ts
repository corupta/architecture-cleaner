// The re-wrap (plan §2.3 S3): a move lengthens the specifiers of the import and `export … from` declarations that
// name a moved file, which may push them past the target's prettier printWidth. Each such touched declaration (its
// module specifier differs from its base counterpart's) is formatted alone with the target's prettier and the file's
// own config, and replaced, when (a) its base counterpart was prettier-stable (we never fix formatting the repo
// didn't have), (b) its head text isn't, and (c) no directive comment acts on its lines; prettier's output must
// differ from it in whitespace and the bindings' trailing comma only. Every other byte stays identical. A file is
// left alone, with the reason, when its counterpart can't be told (no base file, a different number of
// declarations: the ladder never adds or reorders imports), it isn't valid UTF-8 (its bytes wouldn't survive), prettier
// isn't installed for it, ignores it or can't load its config, a source map maps its lines, or a coverage gate measures
// its line totals (K2 refuses a layout change there). Head's configs are read in a checkout whose node_modules are the
// environment's (commit.ts headCheckout). Counterparts: the same path, or the deleted file a new one equals with its
// module specifiers blanked (a move).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { sourcePattern } from '../analyzer/analyze.js';
import { coverageGates } from '../analyzer/coverage-settings.js';
import { extractSites } from '../analyzer/reference-sites.js';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import { headCheckout } from './commit.js';
import { type Declaration, directiveOver, ownsItsLines, readFile, sameDeclarationTokens } from './declarations.js';
import { formatDeclaration, optionsFor, type Prettier, prettierFor } from './prettier.js';

export interface RewrapInput {
  /** The git repository holding both commits. */
  repo: string;
  base: string;
  head: string;
  /**
   * A checkout of the repository: each file's prettier config and ignore files are read there when it is clean at
   * head and its node_modules are the environment's, else in a temporary worktree of head made from it.
   */
  checkout: string;
  /** The checkout whose node_modules hold the target's prettier and what its configs load (plugins, shared configs). */
  environment: string;
  /** Only files under this repo-relative directory ('' for every file). */
  packageRoot: string;
}

export interface Rewrapped {
  file: string;
  /** Head line of the declaration before the re-wrap. */
  line: number;
  before: string;
  after: string;
}

export interface Skip {
  file: string;
  line?: number;
  reason: string;
}

export interface RewrapPlan {
  /** Head path → its re-wrapped text. */
  files: Map<string, string>;
  declarations: Rewrapped[];
  skips: Skip[];
  /** Source files compared with a base counterpart. */
  examined: number;
  /** The prettier versions that formatted something. */
  prettier: string[];
}

function git(repo: string, args: string[]): string {
  const run = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr.trim()}`);
  return run.stdout;
}

interface Blobs {
  /** Text by `<commit>:<path>` (undefined when missing). */
  texts: Map<string, string | undefined>;
  /** The specs whose bytes don't survive a UTF-8 decode and encode: their texts are lossy. */
  notUtf8: Set<string>;
}

/** Blob texts by `<commit>:<path>`, one `git cat-file --batch` for all of them. */
function readBlobs(repo: string, specs: string[]): Blobs {
  const texts = new Map<string, string | undefined>();
  const notUtf8 = new Set<string>();
  if (!specs.length) return { texts, notUtf8 };
  const run = spawnSync('git', ['-C', repo, 'cat-file', '--batch'], { input: `${specs.join('\n')}\n`, maxBuffer: 1 << 30 });
  if (run.status !== 0) throw new Error(`git cat-file --batch failed: ${run.stderr.toString().trim()}`);
  const output = run.stdout;
  let offset = 0;
  for (const spec of specs) {
    const lineEnd = output.indexOf(10, offset);
    const header = output.subarray(offset, lineEnd).toString('utf8');
    offset = lineEnd + 1;
    const size = / blob (\d+)$/.exec(header);
    if (!size) {
      texts.set(spec, undefined);
      continue;
    }
    const bytes = output.subarray(offset, offset + Number(size[1]));
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) notUtf8.add(spec);
    texts.set(spec, text);
    offset += Number(size[1]) + 1;
  }
  return { texts, notUtf8 };
}

/** A file's text with every module specifier blanked (the analyzer's sites): equal for a file and its move. */
function moveKey(file: string, text: string): string {
  let key = '';
  let offset = 0;
  for (const site of extractSites(file, text).sites) {
    key += `${text.slice(offset, site.start)}\0`;
    offset = site.end;
  }
  return key + text.slice(offset);
}

/**
 * Head path → base path of every changed source file: the same path, or for a file that moved, the one deleted
 * file whose text equals it with every module specifier blanked (git's rename detection misses a short file whose
 * specifiers are a large part of it). Added files with no such counterpart are listed apart. Texts are read once.
 */
function changedFiles(input: RewrapInput): { pairs: [string, string][]; added: string[] } & Blobs {
  const pathspec = input.packageRoot ? ['--', input.packageRoot] : [];
  const fields = git(input.repo, ['diff', '--name-status', '-z', '--no-renames', input.base, input.head, ...pathspec]).split('\0');
  const modified: string[] = [];
  const deleted: string[] = [];
  const created: string[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [status, file] = [fields[index]!, fields[index + 1]!];
    if (!sourcePattern.test(file)) continue;
    if (status === 'D') deleted.push(file);
    else if (status === 'A') created.push(file);
    else modified.push(file);
  }
  const { texts, notUtf8 } = readBlobs(input.repo, [...[...modified, ...deleted].map((file) => `${input.base}:${file}`), ...[...modified, ...created].map((file) => `${input.head}:${file}`)]);
  const byKey = new Map<string, string[]>();
  for (const file of deleted) {
    const text = texts.get(`${input.base}:${file}`);
    if (text !== undefined) byKey.set(moveKey(file, text), [...(byKey.get(moveKey(file, text)) ?? []), file]);
  }
  const pairs: [string, string][] = modified.map((file) => [file, file]);
  const added: string[] = [];
  const claimed = new Map<string, number>();
  const candidates = created.map((file) => {
    const text = texts.get(`${input.head}:${file}`);
    const sources = text === undefined ? [] : byKey.get(moveKey(file, text)) ?? [];
    for (const source of sources) claimed.set(source, (claimed.get(source) ?? 0) + 1);
    return { file, sources };
  });
  for (const { file, sources } of candidates) {
    if (sources.length === 1 && claimed.get(sources[0]!) === 1) pairs.push([file, sources[0]!]);
    else added.push(file);
  }
  return { pairs, added, texts, notUtf8 };
}

/** The nearest directory above a file that holds a package.json in head ('' for the root). */
function packageLookup(headFiles: readonly string[]): (file: string) => string {
  const manifests = new Set(headFiles.filter((file) => path.posix.basename(file) === 'package.json').map((file) => path.posix.dirname(file)));
  return (file) => {
    for (let directory = path.posix.dirname(file); directory !== '.'; directory = path.posix.dirname(directory)) if (manifests.has(directory)) return directory;
    return '';
  };
}

// Configs whose coverage settings a gate can measure (analyzer/coverage-settings.ts decides whether one does): the
// executor's copy of the rule K2 applies to a layout change.
const coverageConfig = /(^|\/)(package\.json|(jest|vitest|vite)([.-][^/]*)?\.(config|workspace)([.-][^/]*)?\.[cm]?[jt]s|jest([.-][^/]*)?\.json|\.nycrc(\.(json|ya?ml))?|\.c8rc(\.json)?)$/;

function coverageGateOver(checkout: string, headFiles: readonly string[]): (file: string) => string | null {
  let gate: ((config: string) => string | null) | undefined;
  const configs = headFiles.filter((file) => coverageConfig.test(file) && !file.split('/').includes('node_modules')).sort();
  return (file) => {
    gate ??= coverageGates(gitRepoFs(checkout));
    for (const config of configs) {
      const directory = path.posix.dirname(config);
      if (directory !== '.' && !file.startsWith(`${directory}/`)) continue;
      const where = gate(config);
      if (where) return where;
    }
    return null;
  };
}

async function ignoredByPrettier(prettier: Prettier, file: string, packageDirectory: string): Promise<boolean> {
  const ignoreFiles = ['.gitignore', '.prettierignore'].map((name) => path.join(packageDirectory, name));
  try {
    return (await prettier.getFileInfo(file, { ignorePath: ignoreFiles, resolveConfig: false })).ignored;
  } catch {
    return (await prettier.getFileInfo(file, { ignorePath: ignoreFiles[1]!, resolveConfig: false })).ignored;
  }
}

const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

export async function planRewrap(input: RewrapInput): Promise<RewrapPlan> {
  const checkout = headCheckout(input.checkout, input.head, input.environment);
  try {
    return await planIn(input, checkout.directory);
  } finally {
    checkout.cleanup();
  }
}

/** The plan, with head's configs and ignore files read in `checkout`. */
async function planIn(input: RewrapInput, checkout: string): Promise<RewrapPlan> {
  const plan: RewrapPlan = { files: new Map(), declarations: [], skips: [], examined: 0, prettier: [] };
  const { pairs, added, texts, notUtf8 } = changedFiles(input);
  for (const file of added) plan.skips.push({ file, reason: 'added since base: no file it moved from (the same text up to its module specifiers)' });
  const headFiles = git(input.repo, ['ls-tree', '-r', '-z', '--name-only', input.head]).split('\0').filter(Boolean);
  const headSet = new Set(headFiles);
  const packageOf = packageLookup(headFiles);
  const gateOver = coverageGateOver(checkout, headFiles);
  const versions = new Set<string>();
  for (const [file, from] of pairs.sort(([a], [b]) => a.localeCompare(b))) {
    const before = texts.get(`${input.base}:${from}`);
    const after = texts.get(`${input.head}:${file}`);
    if (before === undefined || after === undefined || before === after) continue;
    plan.examined++;
    const skip = (reason: string, declaration?: Declaration) => plan.skips.push({ file, ...(declaration ? { line: declaration.firstLine } : {}), reason });
    const baseReading = readFile(from, before);
    const headReading = readFile(file, after);
    if (baseReading.declarations.length !== headReading.declarations.length) {
      skip(`${baseReading.declarations.length} import and export-from declarations at base (${from}), ${headReading.declarations.length} at head: their counterparts can't be told`);
      continue;
    }
    const touched = headReading.declarations.flatMap((declaration, index) => (declaration.specifier === baseReading.declarations[index]!.specifier ? [] : [{ head: declaration, base: baseReading.declarations[index]! }]));
    if (!touched.length) continue;
    if (notUtf8.has(`${input.base}:${from}`) || notUtf8.has(`${input.head}:${file}`)) {
      skip('not valid UTF-8: written back as text, its other bytes would change');
      continue;
    }
    if (/[\r\u2028\u2029]/.test(after)) {
      skip('line breaks other than \\n: prettier would rewrite them');
      continue;
    }
    if (headSet.has(`${file}.map`) || /\bsourceMappingURL=/.test(after)) {
      skip('a source map maps its lines');
      continue;
    }
    const packageDirectory = packageOf(file);
    const prettier = await prettierFor(input.environment, packageDirectory);
    if (!prettier) {
      skip(`no prettier installed for ${packageDirectory || 'the repository root'} in ${input.environment}`);
      continue;
    }
    const absolute = path.join(checkout, file);
    if (await ignoredByPrettier(prettier, absolute, path.join(checkout, packageDirectory))) {
      skip('prettier ignores it (.prettierignore or .gitignore)');
      continue;
    }
    const gate = gateOver(file);
    if (gate) {
      skip(`a coverage gate measures its line totals: ${gate}`);
      continue;
    }
    let options: Record<string, unknown>;
    try {
      options = await optionsFor(prettier, checkout, file, packageDirectory);
    } catch (error) {
      skip(`its prettier config can't be loaded: ${(error as Error).message.split('\n')[0]!.replaceAll(`${checkout}${path.sep}`, '')}`);
      continue;
    }
    const replacements: { declaration: Declaration; text: string }[] = [];
    for (const { head, base } of touched) {
      if (!ownsItsLines(after, head)) {
        skip('shares a line with other code or a comment', head);
        continue;
      }
      const directive = directiveOver(head, headReading.comments);
      if (directive) {
        skip(`the directive ${JSON.stringify(directive.text)} on line ${directive.firstLine} acts on its lines`, head);
        continue;
      }
      let formattedBase: string;
      let formattedHead: string;
      try {
        formattedBase = await formatDeclaration(prettier, base.text, options);
        formattedHead = await formatDeclaration(prettier, head.text, options);
      } catch (error) {
        skip(`prettier failed: ${(error as Error).message.split('\n')[0]}`, head);
        continue;
      }
      if (formattedBase !== base.text) {
        skip('its base counterpart was not prettier-formatted either: the repository did not have that formatting', head);
        continue;
      }
      if (formattedHead === head.text) continue;
      if (!sameDeclarationTokens(head.text, formattedHead)) {
        skip('prettier would change more than whitespace and the trailing comma', head);
        continue;
      }
      replacements.push({ declaration: head, text: formattedHead });
    }
    if (!replacements.length) continue;
    versions.add(prettier.version);
    let text = after;
    for (const { declaration, text: formatted } of [...replacements].reverse()) text = text.slice(0, declaration.start) + formatted + text.slice(declaration.end);
    plan.files.set(file, text);
    for (const { declaration, text: formatted } of replacements) plan.declarations.push({ file, line: lineOf(after, declaration.start), before: declaration.text, after: formatted });
  }
  plan.prettier = [...versions].sort();
  return plan;
}

/** One sentence for the commit body and the command's output. */
export function rewrapSummary(plan: RewrapPlan): string {
  const prettier = plan.prettier.length ? ` with prettier ${plan.prettier.join(', ')}` : '';
  return `${plan.declarations.length} import and export declarations re-wrapped in ${plan.files.size} files${prettier}: line breaks, indentation and the trailing comma of their binding lists only`;
}

/** The commit's subject line (conventional: a style change, behavior untouched). */
export const rewrapSubject = (scope: string) => `style(${scope}): re-wrap the import lines the moves lengthened`;

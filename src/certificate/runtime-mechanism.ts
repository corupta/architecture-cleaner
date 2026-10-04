// Which runtimes load a package's code, and the alias layer each one applies (plan §2.5 "unknown runtime alias
// mechanism", §3.4 K3c). Read from the committed tree only: package.json scripts, dependencies and `_moduleAliases`,
// nest-cli.json, tsconfig.json's `ts-node` block, the register imports in the code, and the launch lines of shell
// scripts, Dockerfiles and Procfiles under the package root. Test runners are K3b's consumers, not runtimes.
import path from 'node:path';
import ts from 'typescript';
import { isSourceFile, stripBom } from '../analyzer/analyze.js';
import type { CommitTree } from './git-tree.js';
import type { SpanView } from './spans.js';

/** What starts the process: plain Node, or Node with the tsx or ts-node hooks. */
export type Loader = 'node' | 'tsx' | 'ts-node';
/** Alias layers registered in the process (`-r tsconfig-paths/register`, `module-alias/register`). */
export type Hook = 'tsconfig-paths' | 'module-alias';

export interface Runtime {
  /** e.g. `nest-cli/emit`, `node/emit`, `tsx/source`, `node/emit+tsconfig-paths`. */
  id: string;
  loader: Loader;
  /** emit: Node loads the compiled JavaScript; source: it loads the TypeScript sources (tsx, ts-node, type stripping). */
  loads: 'emit' | 'source';
  /** For emit: tsc emits specifiers verbatim; Nest's tsc builder rewrites tsconfig `paths` aliases (its tsconfig-paths hook). */
  build?: 'tsc' | 'nest-cli';
  hooks: Hook[];
  /** Custom export conditions (`node -C development`), which change how packages and subpath imports resolve. */
  conditions: string[];
  /**
   * The tsconfig whose program this runtime loads (package-root-relative): the one the build compiles (`nest build`'s,
   * `tsc -p`'s), or tsconfig.json for runtimes that load sources. Nest's hook also reads its `paths`.
   */
  tsconfig: string;
  evidence: string[];
  /**
   * Nothing in the tree says how the package runs (no launch command, no main/exports/bin), so plain Node on the
   * emitted JavaScript stands in: the runtime with no alias layer. Its alias mechanism is unknown, not absent.
   */
  assumed?: true;
}

export interface RuntimeDetection {
  /** The runtimes that load the package; one assumed plain Node runtime when nothing in the tree launches it. */
  runtimes: Runtime[];
  /** Mechanisms seen but not modeled: tsc-alias, bundlers, programmatic registration, Nest's swc/webpack builders, ts-node ESM. */
  unsupported: { mechanism: string; evidence: string }[];
  /** package.json `imports` (Node subpath imports, resolved by Node itself). */
  subpathImports: boolean;
}

/**
 * Plain Node stands in, on the emitted JavaScript; when the program emits none (`noEmit`), whatever runs it is unknown,
 * so also on the sources themselves (Node's type stripping).
 */
const assumedRuntime = (tsconfig: string, loads: 'emit' | 'source'): Runtime => ({
  id: `node/${loads} (assumed)`, loader: 'node', loads, ...(loads === 'emit' ? { build: 'tsc' as const } : {}), hooks: [], conditions: [], tsconfig, assumed: true,
  evidence: [`nothing in the tree launches the package (no start or launch command, no main/exports/bin): plain Node on ${loads === 'emit' ? 'the JavaScript compiled' : 'the sources stripped of types'} with ${tsconfig} stands in`],
});

/** Whether the runtime maps tsconfig `paths` or other aliases at all. */
export const hasAliasLayer = (runtime: Runtime) => runtime.build === 'nest-cli' || runtime.loader === 'tsx' || runtime.hooks.length > 0;

const testRunners = new Set(['mocha', 'jest', 'vitest', 'ava', 'tap', 'nyc', 'c8', 'playwright', 'cypress', 'karma', 'jasmine', 'uvu']);
const bundlers = new Set(['webpack', 'esbuild', 'rollup', 'tsup', 'ncc', 'parcel', 'rspack', 'swc', 'babel', 'tsdown', 'unbuild', 'pkgroll']);
const transparentPrograms = new Set(['cross-env', 'npx', 'exec', 'env', 'tini', 'nohup', 'time', 'dumb-init', 'su-exec', 'gosu']);
const valueFlags = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--env-file', '--env-file-if-exists', '--inspect-port', '--title',
  '--stack-size', '--max-old-space-size', '-C', '--conditions', '-P', '--project', '-O', '--compiler-options', '--compiler']);

/** Splits a shell command line into commands (`&&`, `||`, `;`, `|`, `&`, newlines) of unquoted tokens. */
export function shellCommands(line: string): string[][] {
  const commands: string[][] = [];
  let tokens: string[] = [];
  let token = '';
  let started = false;
  const endToken = () => {
    if (started) tokens.push(token);
    token = '';
    started = false;
  };
  const endCommand = () => {
    endToken();
    if (tokens.length) commands.push(tokens);
    tokens = [];
  };
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '"' || character === "'") {
      const close = line.indexOf(character, index + 1);
      token += line.slice(index + 1, close === -1 ? line.length : close);
      started = true;
      index = close === -1 ? line.length : close;
    } else if (character === '\\' && index + 1 < line.length) {
      if (line[index + 1] !== '\n') token += line[index + 1];
      started ||= line[index + 1] !== '\n';
      index++;
    } else if (/\s/.test(character)) {
      if (character === '\n') endCommand();
      else endToken();
    } else if (';&|'.includes(character)) {
      endCommand();
      if (line[index + 1] === character) index++;
    } else {
      token += character;
      started = true;
    }
  }
  endCommand();
  return commands;
}

interface Collected {
  launches: { loader: Loader; loads: 'emit' | 'source'; hooks: Hook[]; conditions: string[]; nest: boolean; evidence: string }[];
  builds: Set<'tsc' | 'nest-cli'>;
  nestTsconfig?: string;
  tscProject?: string;
  unsupported: { mechanism: string; evidence: string }[];
}

const isTypeScriptPath = (file: string) => /\.(c|m)?tsx?$/.test(file);

/**
 * `emits(tsconfig)` (package-root-relative) tells whether that program emits JavaScript (not `noEmit` or
 * `emitDeclarationOnly`), which decides the assumed runtimes when nothing launches the package.
 */
export function detectRuntimes(tree: CommitTree, packageRoot: string, views: (file: string) => SpanView | undefined, emits: (tsconfig: string) => boolean = () => true): RuntimeDetection {
  const prefix = packageRoot ? `${packageRoot}/` : '';
  const readJson = (file: string): Record<string, unknown> | undefined => {
    const text = tree.text(file);
    if (text === undefined) return undefined;
    const parsed = ts.parseConfigFileTextToJson(file, stripBom(text));
    return parsed.error ? undefined : (parsed.config as Record<string, unknown>);
  };
  const manifest = readJson(`${prefix}package.json`) ?? {};
  const scripts = (manifest.scripts ?? {}) as Record<string, string>;
  const nestConfig = readJson(`${prefix}nest-cli.json`);
  const collected: Collected = { launches: [], builds: new Set(), unsupported: [] };

  const nestBuilder = () => {
    const options = (nestConfig?.compilerOptions ?? {}) as { builder?: string | { type?: string }; webpack?: boolean; tsConfigPath?: string };
    if (options.webpack) return 'webpack';
    return (typeof options.builder === 'string' ? options.builder : options.builder?.type) ?? 'tsc';
  };

  const classify = (tokens: string[], evidence: string, visited: Set<string>): void => {
    let index = 0;
    for (; index < tokens.length; index++) {
      const token = tokens[index]!;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || transparentPrograms.has(path.posix.basename(token)) || token === '--') continue;
      if (token === 'dotenv') {
        const separator = tokens.indexOf('--', index);
        if (separator === -1) return;
        index = separator;
        continue;
      }
      break;
    }
    const program = tokens[index] === undefined ? '' : path.posix.basename(tokens[index]!);
    const args = tokens.slice(index + 1);
    // Wrapped commands (`concurrently "a" "b"`, `sh -c "..."`, `nodemon --exec "..."`) are classified on their own.
    for (const argument of args) if (/\s/.test(argument)) for (const command of shellCommands(argument)) classify(command, evidence, visited);
    if (['pnpm', 'yarn', 'bun'].includes(program) && ['exec', 'dlx', 'x'].includes(args[0] ?? '')) {
      classify(args.slice(1), evidence, visited);
      return;
    }
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
      const name = args[0] === 'run' || args[0] === 'run-script' ? args[1] : ['start', 'test'].includes(args[0] ?? '') ? args[0] : program === 'npm' ? undefined : args[0];
      if (name && scripts[name] !== undefined && !visited.has(name)) runScript(name, new Set([...visited, name]));
      return;
    }
    if (testRunners.has(program)) return;
    if (program === 'nest') {
      const builder = nestBuilder();
      if (builder !== 'tsc') {
        collected.unsupported.push({ mechanism: `Nest CLI ${builder} builder`, evidence });
        return;
      }
      const pathFlag = args.findIndex((argument) => argument === '-p' || argument === '--path');
      if (pathFlag !== -1 && args[pathFlag + 1]) collected.nestTsconfig = args[pathFlag + 1];
      if (args[0] === 'build') collected.builds.add('nest-cli');
      if (args[0] === 'start') collected.launches.push({ loader: 'node', loads: 'emit', hooks: [], conditions: [], nest: true, evidence });
      return;
    }
    if (program === 'tsc') {
      if (args.includes('--noEmit') || args.includes('--build') || args.includes('-b')) return;
      collected.builds.add('tsc');
      const project = args.findIndex((argument) => argument === '-p' || argument === '--project');
      if (project !== -1 && args[project + 1]) collected.tscProject ??= args[project + 1]!.replace(/^\.\//, '');
      return;
    }
    if (program === 'tsc-alias') {
      collected.unsupported.push({ mechanism: 'tsc-alias', evidence });
      return;
    }
    if (bundlers.has(program) || ((program === 'vite' || program === 'bun') && args[0] === 'build')) {
      collected.unsupported.push({ mechanism: `bundler or transpiler (${program})`, evidence });
      return;
    }
    if (program === 'tsx') {
      launch('tsx', args[0] === 'watch' ? args.slice(1) : args, evidence);
      return;
    }
    if (['ts-node', 'ts-node-dev', 'tsnd', 'ts-node-esm', 'ts-node-transpile-only'].includes(program)) {
      if (program === 'ts-node-esm' || args.includes('--esm')) {
        collected.unsupported.push({ mechanism: 'ts-node ESM loader', evidence });
        return;
      }
      launch('ts-node', args, evidence);
      return;
    }
    if (program === 'nodemon') {
      const exec = args.findIndex((argument) => argument === '--exec' || argument === '-x');
      // nodemon appends the script to the --exec command; a quoted multi-word --exec was classified above.
      if (exec !== -1) {
        const command = args[exec + 1] ?? '';
        if (command && !/\s/.test(command)) classify([command, ...args.slice(exec + 2)], evidence, visited);
        return;
      }
      const file = args.find((argument) => !argument.startsWith('-'));
      if (file) launch(isTypeScriptPath(file) ? 'ts-node' : 'node', args, evidence);
      return;
    }
    if (program === 'pm2' || program === 'pm2-runtime') {
      const file = args.filter((argument) => !argument.startsWith('-') && argument !== 'start')[0];
      if (file && /\.(c|m)?[jt]s$/.test(file)) launch('node', [file], evidence);
      return;
    }
    if (program === 'node' || program === 'nodejs') launch('node', args, evidence);
  };

  /** `node [flags] <file>`: the preloads decide the loader and hooks, the file's extension what is loaded. */
  const launch = (loader: Loader, args: string[], evidence: string) => {
    const hooks: Hook[] = [];
    const conditions: string[] = [];
    let file: string | undefined;
    for (let index = 0; index < args.length; index++) {
      const argument = args[index]!;
      const [flag, inline] = argument.startsWith('--') && argument.includes('=') ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)] : [argument, undefined];
      if (flag === '-e' || flag === '--eval' || flag === '-p' || flag === '--print' || flag === '--test' || flag === '-v' || flag === '--version') return;
      if (flag === '--tsconfig') {
        collected.unsupported.push({ mechanism: `${loader} with a custom --tsconfig`, evidence });
        return;
      }
      if (valueFlags.has(flag)) {
        const value = inline ?? args[++index] ?? '';
        if (flag === '-C' || flag === '--conditions') conditions.push(value);
        else if (/^tsx(\/|$)/.test(value)) loader = 'tsx';
        else if (/^ts-node(\/register)?(\/transpile-only)?$/.test(value)) loader = 'ts-node';
        else if (/^ts-node\/esm/.test(value)) {
          collected.unsupported.push({ mechanism: 'ts-node ESM loader', evidence });
          return;
        } else if (value === 'tsconfig-paths/register') hooks.push('tsconfig-paths');
        else if (value === 'module-alias/register') hooks.push('module-alias');
        continue;
      }
      if (flag.startsWith('-')) continue;
      file = argument;
      break;
    }
    if (!file) return;
    collected.launches.push({ loader, loads: isTypeScriptPath(file) ? 'source' : 'emit', hooks, conditions, nest: false, evidence });
  };

  const runScript = (name: string, visited: Set<string>) => {
    for (const command of shellCommands(scripts[name]!)) {
      // `cd frontend && vite build`: whatever follows runs in another package.
      if (command[0] === 'cd') break;
      classify(command, `package.json scripts.${name}: ${scripts[name]}`, visited);
    }
  };
  for (const name of Object.keys(scripts)) runScript(name, new Set([name]));

  for (const file of tree.entries.keys()) {
    if (!file.startsWith(prefix) || file.split('/').includes('node_modules')) continue;
    const base = path.posix.basename(file);
    const dockerfile = /^Dockerfile(\..*)?$|\.dockerfile$/i.test(base);
    const procfile = base === 'Procfile';
    const text = (dockerfile || procfile || base.endsWith('.sh') || /(^|\/)bin\/[^/.]+$/.test(file)) ? tree.text(file) : undefined;
    if (text === undefined) continue;
    if (!dockerfile && !procfile && !base.endsWith('.sh') && !/^#![^\n]*\b(ba|da|z)?sh\b/.test(text)) continue;
    const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      let commandLine = line;
      if (dockerfile) {
        const instruction = /^(CMD|ENTRYPOINT)\s+(.*)$/i.exec(line);
        if (!instruction) continue;
        commandLine = instruction[2]!;
        if (commandLine.startsWith('[')) {
          try {
            commandLine = (JSON.parse(commandLine) as string[]).map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
          } catch {
            continue;
          }
        }
      } else if (procfile) commandLine = line.replace(/^[\w-]+:\s*/, '');
      for (const command of shellCommands(commandLine)) classify(command, `${file}: ${line}`, new Set());
    }
  }

  // Alias layers registered from code (`import 'module-alias/register'` in the entry point).
  const codeHooks: { hook: Hook; evidence: string }[] = [];
  const aliasesInManifest = manifest._moduleAliases !== undefined;
  for (const file of tree.entries.keys()) {
    if (!file.startsWith(prefix) || !isSourceFile(file)) continue;
    const view = views(file);
    if (!view?.source) continue;
    for (const site of view.sites) {
      if (site.typeOnly || site.kind === 'mock' || site.kind === 'typeof-import' || site.kind === 'declare-module' || site.kind === 'triple-slash') continue;
      const evidence = `${file}: ${site.kind} '${site.specifier}'`;
      if (site.specifier === 'tsconfig-paths/register') codeHooks.push({ hook: 'tsconfig-paths', evidence });
      else if (site.specifier === 'module-alias/register' && aliasesInManifest) codeHooks.push({ hook: 'module-alias', evidence });
      else if (site.specifier === 'module-alias/register') collected.unsupported.push({ mechanism: 'module-alias/register without package.json _moduleAliases', evidence });
      else if (site.specifier === 'tsconfig-paths' || site.specifier === 'module-alias') collected.unsupported.push({ mechanism: `programmatic ${site.specifier} registration`, evidence });
    }
  }
  const tsNodeOptions = (readJson(`${prefix}tsconfig.json`)?.['ts-node'] ?? {}) as { require?: string[] };
  const tsNodeHooks: Hook[] = (tsNodeOptions.require ?? []).includes('tsconfig-paths/register') ? ['tsconfig-paths'] : [];

  const build = collected.builds.has('nest-cli') || collected.launches.some((launch) => launch.nest) ? 'nest-cli' : 'tsc';
  const nestTsconfig = collected.nestTsconfig
    ?? (nestConfig?.compilerOptions as { tsConfigPath?: string } | undefined)?.tsConfigPath
    ?? (tree.entries.has(`${prefix}tsconfig.build.json`) ? 'tsconfig.build.json' : 'tsconfig.json');
  const runtimes = new Map<string, Runtime>();
  const tscProject = collected.tscProject === undefined ? 'tsconfig.json' : collected.tscProject.endsWith('.json') ? collected.tscProject : `${collected.tscProject.replace(/\/$/, '')}/tsconfig.json`;
  const add = (runtime: Omit<Runtime, 'id' | 'evidence' | 'tsconfig'>, evidence: string[]) => {
    const hooks = [...new Set([...runtime.hooks, ...codeHooks.map((entry) => entry.hook), ...(runtime.loader === 'ts-node' ? tsNodeHooks : [])])].sort();
    const conditions = [...new Set(runtime.conditions)].sort();
    const head = runtime.build === 'nest-cli' && runtime.loads === 'emit' ? 'nest-cli' : runtime.loader;
    const id = `${head}/${runtime.loads}${hooks.length ? `+${hooks.join('+')}` : ''}${conditions.length ? `[${conditions.join(',')}]` : ''}`;
    const existing = runtimes.get(id);
    const allEvidence = [...evidence, ...codeHooks.filter((entry) => hooks.includes(entry.hook)).map((entry) => entry.evidence)];
    if (existing) existing.evidence.push(...allEvidence.filter((line) => !existing.evidence.includes(line)));
    else runtimes.set(id, { ...runtime, hooks, conditions, id, evidence: [...new Set(allEvidence)], tsconfig: head === 'nest-cli' ? nestTsconfig : runtime.loads === 'emit' ? tscProject : 'tsconfig.json' });
  };
  for (const launch of collected.launches) {
    add({ loader: launch.loader, loads: launch.loads, hooks: launch.hooks, conditions: launch.conditions, ...(launch.loads === 'emit' ? { build } : {}) }, [launch.evidence]);
  }
  // A Nest build is the runtime even when only the Dockerfile's `node dist/main.js` shows how it starts.
  if (build === 'nest-cli' && ![...runtimes.values()].some((runtime) => runtime.build === 'nest-cli')) {
    add({ loader: 'node', loads: 'emit', hooks: [], conditions: [], build }, ['package.json: nest build']);
  }
  // Nothing launches a library: its consumers load the emitted JS through main/exports/bin.
  const entryFields = ['main', 'exports', 'bin'].filter((field) => manifest[field] !== undefined);
  if (runtimes.size === 0 && entryFields.length) add({ loader: 'node', loads: 'emit', hooks: [], conditions: [], build }, [`package.json ${entryFields.join('/')}: consumers load the emitted JavaScript`]);
  if (runtimes.size === 0) {
    runtimes.set('assumed-emit', assumedRuntime(tscProject, 'emit'));
    if (!emits(tscProject)) runtimes.set('assumed-source', assumedRuntime(tscProject, 'source'));
  }
  return {
    runtimes: [...runtimes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    unsupported: dedupeBy(collected.unsupported, (entry) => `${entry.mechanism}\0${entry.evidence}`),
    subpathImports: manifest.imports !== undefined,
  };
}

const dedupeBy = <T>(items: T[], key: (item: T) => string) => [...new Map(items.map((item) => [key(item), item])).values()];

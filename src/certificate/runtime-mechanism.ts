// Which runtimes load a package's code, and the alias layer each one applies (plan §2.5 "unknown runtime alias
// mechanism", §3.4 K3c). Read from the committed tree only: package.json scripts, dependencies and `_moduleAliases`,
// nest-cli.json, tsconfig.json's `ts-node` block, the register imports in the code, and the launch lines of shell
// scripts, Dockerfiles and Procfiles under the package root, with the environment they set (`VAR=x cmd`, `export`,
// Dockerfile `ENV`): NODE_OPTIONS carries node flags, NODE_PATH adds lookup roots for bare specifiers. vite-plus tasks
// (`vp run <task>`) are read from the package's vite.config. Test runners are K3b's consumers, not runtimes, with one
// exception: when node runs the CLI of a runner that loads the code under test through Node itself (mocha, ava, tap,
// …), the hooks node preloads apply to that code, so the launch is a runtime. Node running what a bundler built is a
// launch K3c doesn't model: it fails closed on it.
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
  /** NODE_PATH directories (package-root-relative): where CommonJS `require` looks up bare specifiers after node_modules. */
  nodePath: string[];
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

export interface UnsupportedMechanism {
  mechanism: string;
  evidence: string;
  /**
   * It may resolve, beyond the specifiers TypeScript resolves through tsconfig paths/baseUrl, bare specifiers that
   * Node leaves unresolved (an absolute NODE_PATH, module-alias aliases registered from code).
   */
  reaches?: 'bare-specifiers';
  /**
   * A launch K3c can't model (Node on what a bundler built): the bundler resolved the sites when it built, so Node on
   * tsc's output is no model of it, and what the process loads goes unchecked. Always a violation.
   */
  launch?: true;
}

export interface RuntimeDetection {
  /** The runtimes that load the package; one assumed plain Node runtime when nothing in the tree launches it. */
  runtimes: Runtime[];
  /** Mechanisms seen but not modeled: tsc-alias, bundlers, programmatic registration, Nest's swc/webpack builders, ts-node ESM. */
  unsupported: UnsupportedMechanism[];
  /** package.json `imports` (Node subpath imports, resolved by Node itself). */
  subpathImports: boolean;
}

/**
 * Plain Node stands in, on the emitted JavaScript; when the program emits none (`noEmit`), whatever runs it is unknown,
 * so also on the sources themselves (Node's type stripping).
 */
const assumedRuntime = (tsconfig: string, loads: 'emit' | 'source'): Runtime => ({
  id: `node/${loads} (assumed)`, loader: 'node', loads, ...(loads === 'emit' ? { build: 'tsc' as const } : {}), hooks: [], conditions: [], nodePath: [], tsconfig, assumed: true,
  evidence: [`nothing in the tree launches the package (no start or launch command, no main/exports/bin): plain Node on ${loads === 'emit' ? 'the JavaScript compiled' : 'the sources stripped of types'} with ${tsconfig} stands in`],
});

/** Whether the runtime maps tsconfig `paths` or other aliases at all. */
export const hasAliasLayer = (runtime: Runtime) => runtime.build === 'nest-cli' || runtime.loader === 'tsx' || runtime.hooks.length > 0;

const testRunners = new Set(['mocha', 'jest', 'vitest', 'ava', 'tap', 'nyc', 'c8', 'playwright', 'cypress', 'karma', 'jasmine', 'uvu']);
// The packages and bin names under node_modules whose CLI is one of those runners.
const testRunnerEntries = new Set([...testRunners, 'jest-cli', '_mocha']);
// Runners that load the code under test with a resolver of their own (jest-resolve, vite, a browser bundle), which the
// hooks node preloads into the runner's process don't reach. The others load it with Node's require and import.
const ownResolverRunners = new Set(['jest', 'jest-cli', 'vitest', 'cypress', 'karma']);
const bundlers = new Set(['webpack', 'esbuild', 'rollup', 'tsup', 'ncc', 'parcel', 'rspack', 'swc', 'babel', 'tsdown', 'unbuild', 'pkgroll']);
// These emit one file per source, as tsc does (esbuild too without --bundle); the others inline what they resolve.
const transpilers = new Set(['swc', 'babel']);
// Where a bundler writes (esbuild --outdir/--outfile, tsup/swc -d, ncc/webpack/rollup -o, parcel --dist-dir, ...).
const outputFlags = new Set(['--outdir', '--outfile', '--out-dir', '--outDir', '-d', '-o', '--dist-dir', '--output-path', '--dir', '--file']);
// `vp run` flags that run the task in other packages of the workspace (or another directory).
const otherPackageFlags = new Set(['-r', '--recursive', '-t', '--transitive', '--filter', '-F', '-w', '--workspace-root', '-C']);
const viteConfigs = ['vite.config.ts', 'vite.config.mts', 'vite.config.cts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];
const transparentPrograms = new Set(['cross-env', 'npx', 'vpx', 'exec', 'env', 'tini', 'nohup', 'time', 'dumb-init', 'su-exec', 'gosu']);
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

// Node flags that change how modules resolve and load: preloads, loaders, export conditions.
const resolutionFlags = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions']);

/**
 * `node [options] <script>`: the script it runs (option values skipped; undefined for `node -e`, `node --test`, the
 * REPL), and the options before it that change how modules resolve and load, as `[flag, value]` pairs.
 */
export function nodeLaunch(commandLine: string[]): { script: string | undefined; resolution: [string, string][] } {
  const resolution: [string, string][] = [];
  for (let index = 0; index < commandLine.length; index++) {
    const argument = commandLine[index]!;
    const [flag, inline] = argument.startsWith('--') && argument.includes('=') ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)] : [argument, undefined];
    if (!flag.startsWith('-')) return { script: argument, resolution };
    if (['-e', '--eval', '-p', '--print', '--test'].includes(flag)) return { script: undefined, resolution };
    const value = valueFlags.has(flag) ? inline ?? commandLine[++index] : undefined;
    if (value !== undefined && resolutionFlags.has(flag)) resolution.push([flag, value]);
  }
  return { script: undefined, resolution };
}

const normalizedPath = (file: string) => path.posix.normalize(file).replace(/^\.\//, '').replace(/\/$/, '');

/** The test runner whose CLI a script is (`node --inspect-brk node_modules/.bin/jest`, `node node_modules/mocha/bin/_mocha`). */
export function testRunnerOf(file: string): string | undefined {
  const segments = normalizedPath(file).split('/');
  const at = segments.lastIndexOf('node_modules');
  if (at === -1) return undefined;
  const [first, second] = segments.slice(at + 1);
  const name = first === '.bin' ? second : first?.startsWith('@') && second ? `${first}/${second}` : first;
  return name !== undefined && testRunnerEntries.has(name) ? name : undefined;
}

/** What a bundler's command line names as its output, directories or files (package-root-relative). */
function outputsOf(args: string[]): string[] {
  const outputs: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const equals = argument.startsWith('--') ? argument.indexOf('=') : -1;
    if (!outputFlags.has(equals === -1 ? argument : argument.slice(0, equals))) continue;
    const value = equals === -1 ? args[++index] : argument.slice(equals + 1);
    if (value && !value.startsWith('-')) outputs.push(normalizedPath(value));
  }
  return outputs;
}

const unwrapped = (node: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ? unwrapped(node.expression) : node);

/** `{ …, name: value }`'s value (the last one); 'unreadable' when a spread, a computed key or a shorthand may set it. */
function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | 'unreadable' | undefined {
  let value: ts.Expression | undefined;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))) return 'unreadable';
    if (property.name.text === name) value = unwrapped(property.initializer);
  }
  return value;
}

/** A command string or an array of them, as literals. */
function commandsOf(node: ts.Expression): string[] | undefined {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (!ts.isArrayLiteralExpression(node)) return undefined;
  const commands = node.elements.map((element) => (ts.isStringLiteralLike(element) ? element.text : undefined));
  return commands.includes(undefined) ? undefined : (commands as string[]);
}

interface ViteTask {
  file: string;
  /** Run in order, as if joined with `&&`. */
  commands: string[];
  cwd?: string;
}

/**
 * A vite-plus task, `run.tasks.<name>` in the package's vite.config (`export default defineConfig({ … })`): a command,
 * an array of commands, or `{ command, cwd }`. Undefined when the config defines no such task; 'unreadable' when the
 * config or the task isn't a literal.
 */
function viteTask(tree: CommitTree, prefix: string, name: string): ViteTask | 'unreadable' | undefined {
  const file = viteConfigs.map((config) => `${prefix}${config}`).find((config) => tree.entries.has(config));
  const text = file === undefined ? undefined : tree.text(file);
  if (file === undefined || text === undefined) return undefined;
  const sourceFile = ts.createSourceFile(file, stripBom(text), ts.ScriptTarget.Latest, true, /\.(c|m)?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const exported = sourceFile.statements.flatMap((statement) => (ts.isExportAssignment(statement) ? [statement.expression]
    : ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.left.getText(sourceFile) === 'module.exports' ? [statement.expression.right] : []));
  if (exported.length !== 1) return 'unreadable';
  let config = unwrapped(exported[0]!);
  if (ts.isCallExpression(config) && config.expression.getText(sourceFile) === 'defineConfig' && config.arguments.length === 1) config = unwrapped(config.arguments[0]!);
  let task: ts.Expression = config;
  for (const key of ['run', 'tasks', name]) {
    if (!ts.isObjectLiteralExpression(task)) return 'unreadable';
    const value = propertyOf(task, key);
    if (value === undefined || value === 'unreadable') return value;
    task = value;
  }
  if (!ts.isObjectLiteralExpression(task)) {
    const commands = commandsOf(task);
    return commands ? { file, commands } : 'unreadable';
  }
  const command = propertyOf(task, 'command');
  const cwd = propertyOf(task, 'cwd');
  const commands = command === undefined || command === 'unreadable' ? undefined : commandsOf(command);
  if (!commands || cwd === 'unreadable' || (cwd !== undefined && !ts.isStringLiteralLike(cwd))) return 'unreadable';
  return { file, commands, ...(cwd ? { cwd: cwd.text } : {}) };
}

interface Collected {
  launches: { loader: Loader; loads: 'emit' | 'source'; hooks: Hook[]; conditions: string[]; nodePath: string[]; nest: boolean; evidence: string; file?: string }[];
  builds: Set<'tsc' | 'nest-cli'>;
  /** Bundling runs: the bundler and what its command line names as output (empty when it doesn't say). */
  bundles: { bundler: string; outputs: string[]; evidence: string }[];
  nestTsconfig?: string;
  tscProject?: string;
  unsupported: UnsupportedMechanism[];
}

/** Variables a launch inherits from its command line, its script's `export`s or its Dockerfile's `ENV`s. */
type Environment = Readonly<Record<string, string>>;

const isTypeScriptPath = (file: string) => /\.(c|m)?tsx?$/.test(file);
const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
// Variables that point the runtime's TypeScript layer at another tsconfig or baseUrl than the one K3c reads.
const tsconfigVariables = ['TS_NODE_PROJECT', 'TS_NODE_BASEURL', 'TS_NODE_COMPILER_OPTIONS', 'TSX_TSCONFIG_PATH'];

const ecosystemFile = /(^|\/)ecosystem[^/]*\.(c|m)?js$|\.config\.(c|m)?js$|\.json$|\.ya?ml$/;

interface EcosystemApp {
  script: string;
  interpreter?: string;
  nodeArgs: string[];
  /** `env`, then every `env_<name>` (`--env <name>` merges one over `env`); at least `{}`. */
  environments: Record<string, string>[];
}

/** A literal value: string, number, boolean, or arrays and objects of them (undefined when anything is computed). */
function literalValue(node: ts.Expression): unknown {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return node.kind === ts.SyntaxKind.TrueKeyword;
  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map((element) => literalValue(element));
    return values.includes(undefined) ? undefined : values;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const entries = node.properties.map((property) => (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ? [property.name.text, literalValue(property.initializer)] : [undefined, undefined]));
    return entries.some(([key, value]) => key === undefined || value === undefined) ? undefined : Object.fromEntries(entries);
  }
  return undefined;
}

/** The apps of a pm2 ecosystem file (`module.exports = { apps: [...] }`, or JSON), or undefined when they aren't literal. */
function ecosystemApps(file: string, text: string): EcosystemApp[] | undefined {
  let config: unknown;
  if (file.endsWith('.json')) {
    try {
      config = JSON.parse(stripBom(text));
    } catch {
      return undefined;
    }
  } else if (/\.(c|m)?js$/.test(file)) {
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const exported = sourceFile.statements.flatMap((statement) => (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
      && statement.expression.left.getText(sourceFile) === 'module.exports' ? [statement.expression.right] : ts.isExportAssignment(statement) ? [statement.expression] : []));
    config = exported.length === 1 ? literalValue(exported[0]!) : undefined;
  }
  const apps = (config as { apps?: unknown } | undefined)?.apps;
  if (!Array.isArray(apps)) return undefined;
  const parsed: EcosystemApp[] = [];
  for (const app of apps as Record<string, unknown>[]) {
    const nodeArgs = app.node_args ?? app.nodeArgs ?? [];
    const blocks = Object.entries(app).filter(([key]) => key === 'env' || key.startsWith('env_')).map(([, value]) => value);
    if (typeof app.script !== 'string' || (app.interpreter !== undefined && typeof app.interpreter !== 'string')
      || !(typeof nodeArgs === 'string' || (Array.isArray(nodeArgs) && nodeArgs.every((argument) => typeof argument === 'string')))
      || blocks.some((block) => !block || typeof block !== 'object')) return undefined;
    const base = (app.env ?? {}) as Record<string, unknown>;
    const strings = (block: object) => Object.fromEntries(Object.entries(block).map(([key, value]) => [key, String(value)]));
    parsed.push({
      script: app.script,
      ...(app.interpreter !== undefined ? { interpreter: app.interpreter as string } : {}),
      nodeArgs: typeof nodeArgs === 'string' ? shellCommands(nodeArgs).flat() : nodeArgs as string[],
      environments: [strings(base), ...Object.entries(app).filter(([key]) => key.startsWith('env_')).map(([, value]) => strings({ ...base, ...(value as object) }))],
    });
  }
  return parsed;
}

/** `export A=1 B=2` (a command of its own): the variables it exports. */
function exported(command: string[]): Record<string, string> | undefined {
  if (command[0] !== 'export') return undefined;
  return Object.fromEntries(command.slice(1).flatMap((token) => {
    const match = assignment.exec(token);
    return match ? [[match[1]!, match[2]!]] : [];
  }));
}

/** Dockerfile `ENV A=1 B=2` or the legacy `ENV A 1`. */
function dockerEnvironment(arguments_: string): Record<string, string> {
  const tokens = shellCommands(arguments_)[0] ?? [];
  if (tokens.length >= 2 && !assignment.test(tokens[0]!)) return { [tokens[0]!]: tokens.slice(1).join(' ') };
  return exported(['export', ...tokens]) ?? {};
}

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
  const collected: Collected = { launches: [], builds: new Set(), bundles: [], unsupported: [] };

  const nestBuilder = () => {
    const options = (nestConfig?.compilerOptions ?? {}) as { builder?: string | { type?: string }; webpack?: boolean; tsConfigPath?: string };
    if (options.webpack) return 'webpack';
    return (typeof options.builder === 'string' ? options.builder : options.builder?.type) ?? 'tsc';
  };

  const classify = (tokens: string[], evidence: string, visited: Set<string>, inherited: Environment): void => {
    const environment: Record<string, string> = { ...inherited };
    let index = 0;
    for (; index < tokens.length; index++) {
      const token = tokens[index]!;
      const variable = assignment.exec(token);
      if (variable) {
        environment[variable[1]!] = variable[2]!;
        continue;
      }
      if (transparentPrograms.has(path.posix.basename(token)) || token === '--') continue;
      if (token === 'dotenv') {
        // dotenv-cli: `-e <file>` (default .env) and `-v KEY=value` set the environment of the command after `--`.
        const separator = tokens.indexOf('--', index);
        if (separator === -1) return;
        const files = tokens.slice(index + 1, separator).flatMap((argument, position, list) => (argument === '-e' && list[position + 1] ? [list[position + 1]!] : []));
        for (const file of files.length ? files : ['.env']) Object.assign(environment, { ...environmentFile(file), ...environment });
        tokens.slice(index + 1, separator).forEach((argument, position, list) => {
          const variable = argument === '-v' ? assignment.exec(list[position + 1] ?? '') : null;
          if (variable) environment[variable[1]!] = variable[2]!;
        });
        index = separator;
        continue;
      }
      break;
    }
    const program = tokens[index] === undefined ? '' : path.posix.basename(tokens[index]!);
    const args = tokens.slice(index + 1);
    // Wrapped commands (`concurrently "a" "b"`, `sh -c "..."`, `nodemon --exec "..."`) are classified on their own.
    for (const argument of args) if (/\s/.test(argument)) runCommands(shellCommands(argument), evidence, visited, environment);
    if (['pnpm', 'yarn', 'bun'].includes(program) && ['exec', 'dlx', 'x'].includes(args[0] ?? '')) {
      classify(args.slice(1), evidence, visited, environment);
      return;
    }
    if (program === 'vp' || program === 'vpr') {
      vitePlus(program === 'vpr' ? ['run', ...args] : args, evidence, visited, environment);
      return;
    }
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
      const name = args[0] === 'run' || args[0] === 'run-script' ? args[1] : ['start', 'test'].includes(args[0] ?? '') ? args[0] : program === 'npm' ? undefined : args[0];
      if (name && scripts[name] !== undefined && !visited.has(name)) runScript(name, new Set([...visited, name]), environment);
      return;
    }
    if (testRunners.has(program)) return;
    if (program === 'nest') {
      const builder = nestBuilder();
      if (builder !== 'tsc') {
        collected.unsupported.push({ mechanism: `Nest CLI ${builder} builder`, evidence });
        // swc emits one file per source; webpack and rspack bundle, and `nest start` then runs the bundle.
        if (builder === 'webpack' || builder === 'rspack') {
          collected.bundles.push({ bundler: `Nest CLI ${builder}`, outputs: [], evidence });
          if (args[0] === 'start') collected.unsupported.push({ mechanism: `Node on a bundle (Nest CLI ${builder})`, evidence, launch: true });
        }
        return;
      }
      const pathFlag = args.findIndex((argument) => argument === '-p' || argument === '--path');
      if (pathFlag !== -1 && args[pathFlag + 1]) collected.nestTsconfig = args[pathFlag + 1];
      if (args[0] === 'build') collected.builds.add('nest-cli');
      if (args[0] === 'start') launch('node', [], evidence, environment, true);
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
      bundle(program, bundlers.has(program) ? args : args.slice(1), evidence);
      return;
    }
    if (program === 'tsx') {
      launch('tsx', args[0] === 'watch' ? args.slice(1) : args, evidence, environment);
      return;
    }
    if (['ts-node', 'ts-node-dev', 'tsnd', 'ts-node-esm', 'ts-node-transpile-only'].includes(program)) {
      if (program === 'ts-node-esm' || args.includes('--esm')) {
        collected.unsupported.push({ mechanism: 'ts-node ESM loader', evidence });
        return;
      }
      launch('ts-node', args, evidence, environment);
      return;
    }
    if (program === 'nodemon') {
      const exec = args.findIndex((argument) => argument === '--exec' || argument === '-x');
      // nodemon appends the script to the --exec command; a quoted multi-word --exec was classified above.
      if (exec !== -1) {
        const command = args[exec + 1] ?? '';
        if (command && !/\s/.test(command)) classify([command, ...args.slice(exec + 2)], evidence, visited, environment);
        return;
      }
      const file = args.find((argument) => !argument.startsWith('-'));
      if (file) launch(isTypeScriptPath(file) ? 'ts-node' : 'node', args, evidence, environment);
      return;
    }
    if (program === 'pm2' || program === 'pm2-runtime') {
      const file = args.filter((argument) => !argument.startsWith('-') && argument !== 'start')[0];
      if (file && ecosystemFile.test(file)) ecosystem(file.replace(/^\.\//, ''), evidence, environment);
      else if (file && /\.(c|m)?[jt]s$/.test(file)) launch('node', [file], evidence, environment);
      return;
    }
    if (program === 'node' || program === 'nodejs') launch('node', args, evidence, environment);
  };

  /** A bundler or transpiler run, reported as not modeled; a bundling one is also where Node's input may come from. */
  const bundle = (bundler: string, args: string[], evidence: string) => {
    collected.unsupported.push({ mechanism: `bundler or transpiler (${bundler})`, evidence });
    if (!transpilers.has(bundler) && (bundler !== 'esbuild' || args.includes('--bundle'))) collected.bundles.push({ bundler, outputs: outputsOf(args), evidence });
  };

  /**
   * vite-plus: `vp run <name>` runs the package.json script, else the vite.config task of that name; `vp build` and
   * `vp pack` bundle; `vp exec`/`vp dlx` and `vp node` run a binary and Node. `vp test` is Vitest, and the rest (dev,
   * check, lint, fmt) don't launch the package.
   */
  const vitePlus = (args: string[], evidence: string, visited: Set<string>, environment: Environment) => {
    const [command, ...rest] = args;
    if (command === 'build' || command === 'pack') bundle(`vp ${command}`, rest, evidence);
    else if (command === 'exec' || command === 'dlx') classify(rest, evidence, visited, environment);
    else if (command === 'node') launch('node', rest, evidence, environment);
    // In other packages (`-r`, `--filter`, `-C <dir>`), as after `cd`, whatever runs isn't this package's.
    if (command !== 'run' || rest.some((argument) => otherPackageFlags.has(argument.split('=')[0]!))) return;
    const name = rest.find((argument) => !argument.startsWith('-'));
    if (name === undefined || visited.has(name)) return;
    if (scripts[name] !== undefined) {
      runScript(name, new Set([...visited, name]), environment);
      return;
    }
    const task = viteTask(tree, prefix, name);
    if (task === 'unreadable') collected.unsupported.push({ mechanism: 'vite-plus task in a vite.config that is not a literal', evidence });
    else if (task && (task.cwd === undefined || normalizedPath(task.cwd) === '.')) {
      const commands = task.commands.join(' && ');
      runCommands(shellCommands(commands), `${evidence} -> ${task.file} run.tasks.${name}: ${commands}`, new Set([...visited, name]), environment);
    }
  };

  /** Commands run in sequence: an `export` reaches the commands after it. */
  const runCommands = (commands: string[][], evidence: string, visited: Set<string>, inherited: Environment) => {
    let environment = inherited;
    for (const command of commands) {
      const variables = exported(command);
      if (variables) environment = { ...environment, ...variables };
      else classify(command, evidence, visited, environment);
    }
  };

  /**
   * `node [flags] <file>`: the preloads decide the loader and hooks, the file's extension what is loaded. NODE_OPTIONS
   * flags apply before the command line's; NODE_PATH adds lookup roots. `nest start` runs Nest's emitted entry.
   */
  const launch = (loader: Loader, commandLine: string[], evidence: string, inherited: Environment, nest = false) => {
    // A runner with a resolver of its own loads the code under test with it (K3b's): the hooks stay in its process.
    // mocha and the others load it with Node, preloads included: a runtime on what they load, the sources when tsx or
    // ts-node is preloaded, else the emitted JavaScript.
    const { script } = nodeLaunch(commandLine);
    const runner = !nest && script !== undefined ? testRunnerOf(script) : undefined;
    if (runner !== undefined && ownResolverRunners.has(runner)) return;
    const hooks: Hook[] = [];
    const conditions: string[] = [];
    const nodePath: string[] = [];
    // `node --env-file=<file>` loads it before startup (NODE_PATH and NODE_OPTIONS included); the inherited environment wins.
    const fromFiles: Record<string, string> = {};
    for (let index = 0; index < commandLine.length && commandLine[index]!.startsWith('-'); index++) {
      const [flag, inline] = commandLine[index]!.includes('=') ? [commandLine[index]!.slice(0, commandLine[index]!.indexOf('=')), commandLine[index]!.slice(commandLine[index]!.indexOf('=') + 1)] : [commandLine[index]!, undefined];
      const value = valueFlags.has(flag) && inline === undefined ? commandLine[++index] : inline;
      if ((flag === '--env-file' || flag === '--env-file-if-exists') && value) Object.assign(fromFiles, environmentFile(value));
    }
    const environment = { ...fromFiles, ...inherited };
    for (const variable of tsconfigVariables) {
      if (environment[variable] !== undefined) collected.unsupported.push({ mechanism: `${variable} (the runtime reads another tsconfig or baseUrl)`, evidence });
    }
    for (const directory of (environment.NODE_PATH ?? '').split(':').filter(Boolean)) {
      if (path.posix.isAbsolute(directory) || directory.includes('$')) collected.unsupported.push({ mechanism: 'NODE_PATH with an absolute or computed directory', evidence, reaches: 'bare-specifiers' });
      else nodePath.push(path.posix.normalize(directory).replace(/\/$/, ''));
    }
    const options = shellCommands(environment.NODE_OPTIONS ?? '').flat();
    const args = [...options, ...commandLine];
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
      if (flag.startsWith('-') || index < options.length) continue;
      file = argument;
      break;
    }
    if (nest) collected.launches.push({ loader, loads: 'emit', hooks, conditions, nodePath, nest, evidence });
    else if (file && runner !== undefined) collected.launches.push({ loader, loads: loader === 'node' ? 'emit' : 'source', hooks, conditions, nodePath, nest, evidence });
    else if (file) collected.launches.push({ loader, loads: isTypeScriptPath(file) ? 'source' : 'emit', hooks, conditions, nodePath, nest, evidence, file });
  };

  /** The variables of a tracked dotenv file (package-root-relative); an untracked one is the environment's (residual risk). */
  const environmentFile = (file: string): Record<string, string> => {
    const variables: Record<string, string> = {};
    for (const line of (tree.text(`${prefix}${path.posix.normalize(file)}`) ?? '').split(/\r?\n/)) {
      const variable = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (variable) variables[variable[1]!] = variable[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
    return variables;
  };

  /** A pm2 ecosystem file: each app runs its script under its interpreter with its node_args and each of its env blocks. */
  const ecosystem = (file: string, evidence: string, environment: Environment) => {
    const text = tree.text(`${prefix}${file}`);
    const apps = text === undefined ? undefined : ecosystemApps(file, text);
    if (!apps) {
      collected.unsupported.push({ mechanism: 'pm2 ecosystem file that is not a literal apps list', evidence, reaches: 'bare-specifiers' });
      return;
    }
    for (const app of apps) {
      const interpreter = path.posix.basename(app.interpreter ?? 'node');
      const loader = interpreter === 'node' ? 'node' : interpreter === 'tsx' ? 'tsx' : interpreter === 'ts-node' ? 'ts-node' : undefined;
      if (!loader) {
        collected.unsupported.push({ mechanism: `pm2 interpreter ${interpreter}`, evidence, reaches: 'bare-specifiers' });
        continue;
      }
      for (const variables of app.environments) launch(loader, [...app.nodeArgs, app.script], `${evidence} (${file}: ${app.script})`, { ...environment, ...variables });
    }
  };

  const runScript = (name: string, visited: Set<string>, inherited: Environment) => {
    const commands = shellCommands(scripts[name]!);
    // `cd frontend && vite build`: whatever follows runs in another package.
    const inPackage = commands.findIndex((command) => command[0] === 'cd');
    runCommands(inPackage === -1 ? commands : commands.slice(0, inPackage), `package.json scripts.${name}: ${scripts[name]}`, visited, inherited);
  };
  for (const name of Object.keys(scripts)) runScript(name, new Set([name]), {});

  for (const file of tree.entries.keys()) {
    if (!file.startsWith(prefix) || file.split('/').includes('node_modules')) continue;
    const base = path.posix.basename(file);
    const dockerfile = /^Dockerfile(\..*)?$|\.dockerfile$/i.test(base);
    const procfile = base === 'Procfile';
    const text = (dockerfile || procfile || base.endsWith('.sh') || /(^|\/)bin\/[^/.]+$/.test(file)) ? tree.text(file) : undefined;
    if (text === undefined) continue;
    if (!dockerfile && !procfile && !base.endsWith('.sh') && !/^#![^\n]*\b(ba|da|z)?sh\b/.test(text)) continue;
    const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
    let environment: Environment = {};
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      let commandLine = line;
      if (dockerfile) {
        // Each build stage starts from its own image: its ENVs are the ones after its FROM.
        if (/^FROM\s/i.test(line)) environment = {};
        const variables = /^ENV\s+(.*)$/i.exec(line);
        if (variables) environment = { ...environment, ...dockerEnvironment(variables[1]!) };
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
      const commands = shellCommands(commandLine);
      // A shell script's `export` lasts until the script ends; a Procfile line or a CMD is one process tree.
      if (!dockerfile && !procfile && commands.length === 1 && exported(commands[0]!)) environment = { ...environment, ...exported(commands[0]!) };
      else runCommands(commands, `${file}: ${line}`, new Set(), environment);
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
      else if (site.specifier === 'tsconfig-paths') collected.unsupported.push({ mechanism: 'programmatic tsconfig-paths registration', evidence });
      else if (site.specifier === 'module-alias') collected.unsupported.push({ mechanism: 'programmatic module-alias registration', evidence, reaches: 'bare-specifiers' });
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
    const id = `${head}/${runtime.loads}${hooks.length ? `+${hooks.join('+')}` : ''}${conditions.length ? `[${conditions.join(',')}]` : ''}${runtime.nodePath.length ? `{NODE_PATH=${runtime.nodePath.join(':')}}` : ''}`;
    const existing = runtimes.get(id);
    const allEvidence = [...evidence, ...codeHooks.filter((entry) => hooks.includes(entry.hook)).map((entry) => entry.evidence)];
    if (existing) existing.evidence.push(...allEvidence.filter((line) => !existing.evidence.includes(line)));
    else runtimes.set(id, { ...runtime, hooks, conditions, id, evidence: [...new Set(allEvidence)], tsconfig: head === 'nest-cli' ? nestTsconfig : runtime.loads === 'emit' ? tscProject : 'tsconfig.json' });
  };
  // What a bundler built, Node runs: the bundler's output holds the file, or no tsc or Nest build is seen at all and
  // the file isn't one the tree tracks (a committed server.js runs as committed).
  const bundleOf = (file: string | undefined) => {
    const launched = file === undefined ? undefined : normalizedPath(file);
    return collected.bundles.find((entry) => launched !== undefined && entry.outputs.some((output) => launched === output || launched.startsWith(`${output}/`)))
      ?? (collected.builds.size === 0 && (launched === undefined || !tree.entries.has(`${prefix}${launched}`)) ? collected.bundles[0] : undefined);
  };
  const onBundle = (bundled: Collected['bundles'][number], evidence: string) => collected.unsupported.push({ mechanism: `Node on a bundle (${bundled.bundler})`, evidence: `${evidence}; built by ${bundled.evidence}`, launch: true });
  for (const launch of collected.launches) {
    const bundled = launch.loads === 'emit' && !launch.nest && launch.file !== undefined ? bundleOf(launch.file) : undefined;
    if (bundled) onBundle(bundled, launch.evidence);
    else add({ loader: launch.loader, loads: launch.loads, hooks: launch.hooks, conditions: launch.conditions, nodePath: launch.nodePath, ...(launch.loads === 'emit' ? { build } : {}) }, [launch.evidence]);
  }
  // A Nest build is the runtime even when only the Dockerfile's `node dist/main.js` shows how it starts.
  if (build === 'nest-cli' && ![...runtimes.values()].some((runtime) => runtime.build === 'nest-cli')) {
    add({ loader: 'node', loads: 'emit', hooks: [], conditions: [], nodePath: [], build }, ['package.json: nest build']);
  }
  const unmodeledLaunch = () => collected.unsupported.some((entry) => entry.launch);
  // Nothing launches a library: its consumers load the emitted JS (or the bundle) through main/exports/bin.
  const entryFields = ['main', 'exports', 'bin'].filter((field) => manifest[field] !== undefined);
  if (runtimes.size === 0 && entryFields.length && !unmodeledLaunch()) {
    const evidence = `package.json ${entryFields.join('/')}: consumers load the emitted JavaScript`;
    const bundled = bundleOf(typeof manifest.main === 'string' ? manifest.main : undefined);
    if (bundled) onBundle(bundled, evidence);
    else add({ loader: 'node', loads: 'emit', hooks: [], conditions: [], nodePath: [], build }, [evidence]);
  }
  if (runtimes.size === 0 && !unmodeledLaunch()) {
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

// R4's anti-vacuity check (plan §2.3): one synthetic violation per rule, each a new file whose one import breaks
// exactly that rule (per-module rules: every module's), added to a scratch worktree and cruised once with the
// baseline. A rule that doesn't fire on its own synthetic import is vacuous. Real files are preferred as import
// targets; when the tree has none that fit, the probe adds an empty one where the rule needs it.
import path from 'node:path';
import type { Violation } from './dependency-cruiser.js';
import { compare, isTestCode, type FolderGraph } from './folder-graph.js';
import type { Persistence } from './persistence.js';
import { allowedImports, type BoundaryRule } from './rules.js';

export interface Probe {
  rule: string;
  /** Package-relative path → content of the files the probe adds. */
  files: Map<string, string>;
  /** The import that must break the rule (package-relative). */
  edge: { from: string; to: string };
  description: string;
}

export interface AntiVacuityEntry {
  rule: string;
  fired: boolean;
  detail: string;
}

export interface ProbeInput {
  graph: FolderGraph;
  rules: BoundaryRule[];
  order: string[];
  persistence: Persistence;
  /** Package-relative files of the tree (tracked), so probe files never collide with one. */
  existing: ReadonlySet<string>;
}

const join = (...parts: string[]) => parts.filter(Boolean).join('/');
const isProduction = (file: string) => !isTestCode(file) && !/\.d\.[cm]?ts$/.test(file) && /\.[cm]?[jt]sx?$/.test(file);
const emptyModule = 'export {};\n';

/** `import '<relative path with extension>';` from `from` to `to` (package-relative). */
export function importLine(from: string, to: string): string {
  const relative = path.posix.relative(path.posix.dirname(from), to);
  return `import '${relative.startsWith('.') ? relative : `./${relative}`}';\n`;
}

export function antiVacuityProbes({ graph, rules, order, persistence, existing }: ProbeInput): Probe[] {
  const { moduleRoot } = graph.layout;
  const taken = (candidate: string) => existing.has(candidate) || [...existing].some((file) => file.startsWith(`${candidate}/`));
  const fresh = (directory: string) => {
    let candidate = directory;
    for (let suffix = 2; taken(candidate); suffix++) candidate = `${directory}-${suffix}`;
    return candidate;
  };
  const probeDirectory = fresh(join(moduleRoot, 'boundary-probe'));
  const probeModuleFile = `${fresh(join(moduleRoot, 'modules', 'boundary-probe'))}/boundary-probe.ts`;
  const folderPath = (key: string) => graph.folders.find((folder) => folder.key === key)?.path ?? '';
  const productionOf = (key: string) => (graph.filesOf.get(key) ?? []).filter(isProduction);
  const publicOf = (key: string) => (graph.publicFiles[key] ?? []).filter(isProduction);
  // Platform probes stay out of the composition root, which the rules exempt.
  const platforms = graph.folders.filter((folder) => folder.key.startsWith('platform/') && folder.key !== graph.compositionRoot).map((folder) => folder.key);
  const platformDirectory = platforms.length ? folderPath(platforms[0]!) : join(moduleRoot, 'platform', 'boundary-probe');
  const allowed = allowedImports(graph, order);
  const position = new Map(order.map((key, at) => [key, at]));

  const probe = (rule: string, from: string, to: string, description: string, added: [string, string][] = []): Probe => ({
    rule, edge: { from, to }, description, files: new Map([[from, `// architecture-cleaner anti-vacuity probe for ${rule}\n${importLine(from, to)}`], ...added]),
  });
  const probes: Probe[] = [];
  for (const rule of rules) {
    switch (rule.kind) {
      case 'shared-leaf': {
        const target = platforms.flatMap(productionOf)[0];
        const to = target ?? `${probeDirectory}/shared-target.ts`;
        probes.push(probe(rule.name, join(moduleRoot, 'shared', 'boundary-probe.ts'), to, 'a shared file imports a file outside shared', target ? [] : [[to, emptyModule]]));
        break;
      }
      case 'platform-not-modules': {
        const module = order.find((key) => publicOf(key).length);
        const to = module ? publicOf(module)[0]! : probeModuleFile;
        probes.push(probe(rule.name, `${platformDirectory}/boundary-probe.ts`, to, 'a platform file imports a module\'s public file', module ? [] : [[to, emptyModule]]));
        break;
      }
      case 'controller-not-persistence': {
        const persistent = [...persistence.dataAccess, ...persistence.schema].filter(isProduction).sort(compare);
        const inModule = persistent.find((file) => graph.modules.some((key) => file.startsWith(`${folderPath(key)}/`)));
        const outside = persistent.find((file) => !file.startsWith(join(moduleRoot, 'modules') + '/'));
        if (inModule) {
          const directory = path.posix.dirname(inModule);
          probes.push(probe(rule.name, `${directory}/boundary-probe.controller.ts`, inModule, 'a controller imports its own module\'s persistence'));
        } else {
          const to = outside ?? `${probeDirectory}/boundary-probe.repository.ts`;
          probes.push(probe(rule.name, `${probeDirectory}/boundary-probe.controller.ts`, to, 'a controller imports persistence', outside ? [] : [[to, '// architecture-cleaner anti-vacuity probe: a data-access file\nexport {};\n']]));
        }
        break;
      }
      case 'folder-cycle': {
        const inside = `${platformDirectory}/boundary-probe-cycle.ts`;
        const outside = `${probeDirectory}/cycle.ts`;
        probes.push(probe(rule.name, inside, outside, 'a platform file and a file outside its folder import each other',
          [[outside, `// architecture-cleaner anti-vacuity probe for ${rule.name}\n${importLine(outside, inside)}`]]));
        break;
      }
      case 'module-dag': {
        const key = rule.module!;
        const may = new Set([key, ...(allowed.get(key) ?? [])]);
        const candidates = order.filter((other) => !may.has(other) && publicOf(other).length);
        const target = candidates.find((other) => position.get(other)! < position.get(key)!) ?? candidates[0];
        const to = target ? publicOf(target)[0]! : probeModuleFile;
        probes.push(probe(rule.name, `${folderPath(key)}/boundary-probe-dag.ts`, to,
          `${key} imports ${target ?? 'a new module'}, which is not on its list`, target ? [] : [[to, emptyModule]]));
        break;
      }
      case 'module-public-files': {
        const key = rule.module!;
        const publicFiles = new Set(publicOf(key));
        const target = productionOf(key).find((file) => !publicFiles.has(file));
        const to = target ?? `${folderPath(key)}/boundary-probe-private.ts`;
        probes.push(probe(rule.name, `${probeDirectory}/public-${key.slice('module/'.length)}.ts`, to,
          `a file outside ${key} imports its private file`, target ? [] : [[to, emptyModule]]));
        break;
      }
    }
  }
  return probes;
}

/** All probe files in one map; a path two probes add must have one content. */
export function probeFiles(probes: Probe[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const probe of probes) {
    for (const [file, content] of probe.files) {
      const existing = files.get(file);
      if (existing !== undefined && existing !== content) throw new Error(`two anti-vacuity probes write ${file} differently`);
      files.set(file, content);
    }
  }
  return files;
}

/** Each probe fired when its rule reports its import; `unexpected` are the new violations no probe asked for. */
export function judgeProbes(probes: Probe[], errors: Violation[]): { entries: AntiVacuityEntry[]; unexpected: Violation[] } {
  const matches = (violation: Violation, probe: Probe) => violation.from === probe.edge.from && violation.to === probe.edge.to;
  const entries = probes.map((probe) => {
    const onEdge = errors.filter((violation) => matches(violation, probe));
    const fired = onEdge.some((violation) => violation.rule.name === probe.rule);
    const others = [...new Set(onEdge.map((violation) => violation.rule.name).filter((name) => name !== probe.rule))].sort(compare);
    return {
      rule: probe.rule, fired,
      detail: `${probe.description}: ${probe.edge.from} -> ${probe.edge.to}${fired ? '' : ' did not fire'}${others.length ? `; also broke ${others.join(', ')}` : ''}`,
    };
  });
  const unexpected = errors.filter((violation) => !probes.some((probe) => probe.rule === violation.rule.name && matches(violation, probe)));
  return { entries, unexpected };
}

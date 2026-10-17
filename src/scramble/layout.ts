// The planned scramble (plan §7): every scored feature file moves to `<moduleRoot>/<plural(type)>/<qualifiers…>/<basename>`
// (qualifiers: the sub-folders under its feature folder that aren't type folders), shared and root files stay. Two files
// landing on one path (or on a file that stays) are renamed from their primary exported symbol, else prefixed with
// their feature (leaky); H1 then gives every moving feature file an opaque name. Co-located tests follow their subject,
// renamed with it. A type folder never shadows a module file of the same name (hoppscotch's `src/utils.ts`): its
// singular is used instead (`src/util/`), since alias rewriters at build time emit './' for 'src/utils' inside
// `src/utils/` (the executor declines that shape). Pure: the executor decides later what actually moves.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { featureOf, kebab, technicalType, typeFolderOf, typeFolders, unsuffixedTypes } from './classify.js';
import type { Inventory } from './inventory.js';
import type { ScrambleEntity, ScrambleManifest, ScrambleVariant } from './types.js';

export interface ScrambleLayout {
  /** Every scored file, sorted by original path; `scrambled` is the planned destination. */
  entities: ScrambleEntity[];
  excluded: { path: string; reason: string }[];
  /** Moving feature file → its co-located tests and their destinations. */
  tests: Map<string, Map<string, string>>;
}

const moduleExtension = /\.(d\.)?[cm]?[jt]sx?$/;
const extensionOf = (file: string) => /\.(ts|tsx|mts|cts)$/.exec(file)?.[0] ?? '';
const stemOf = (file: string) => path.posix.basename(file).slice(0, path.posix.basename(file).length - extensionOf(file).length);
const roleSuffix = (type: string) => (unsuffixedTypes.has(type) ? '' : `.${type}`);
/** Collisions are judged case-insensitively: the scrambled tree must check out on macOS and Windows too. */
const collisionKey = (file: string) => file.toLowerCase();

export function layoutScramble(manifest: ScrambleManifest, variant: ScrambleVariant, inventory: Inventory): ScrambleLayout {
  const modulePrefix = `${manifest.moduleRoot}/`;
  const excludePatterns = manifest.exclude.map((source) => ({ source, pattern: new RegExp(source) }));
  const excluded: { path: string; reason: string }[] = [];
  const entities: ScrambleEntity[] = [];
  const moduleStems = new Set(inventory.tracked.filter((file) => moduleExtension.test(file)).map((file) => collisionKey(file.replace(moduleExtension, ''))));
  const folderOf = (type: string) => {
    const plural = typeFolderOf(type);
    const shadows = (folder: string) => moduleStems.has(collisionKey(`${manifest.moduleRoot}/${folder}`));
    return shadows(plural) && !shadows(type) ? type : plural;
  };
  for (const file of inventory.code) {
    const pattern = excludePatterns.find((candidate) => candidate.pattern.test(file.path));
    if (pattern || file.barrel) {
      excluded.push({ path: file.path, reason: pattern ? `excluded by the manifest (${pattern.source})` : 'barrel (re-exports only)' });
      continue;
    }
    const feature = featureOf(manifest, file.path.slice(modulePrefix.length));
    const { type, via } = technicalType(path.posix.basename(file.path), feature.inner, file);
    const qualifiers = feature.inner.slice(0, -1).filter((segment) => !typeFolders[segment]);
    const scrambled = feature.kind === 'feature' ? [manifest.moduleRoot, folderOf(type), ...qualifiers, path.posix.basename(file.path)].join('/') : file.path;
    entities.push({ original: file.path, scrambled, truth: feature.truth, truthKind: feature.kind, type, typeVia: via, leaky: false });
  }
  const primaryExport = new Map(inventory.code.map((file) => [file.path, file.primaryExport]));
  const moving = entities.filter((entity) => entity.truthKind === 'feature');
  const testsOf = new Map<string, string[]>();
  for (const test of inventory.tests) if (test.subject) testsOf.set(test.subject, [...(testsOf.get(test.subject) ?? []), test.path]);

  // Paths that stay occupied: every tracked package file that doesn't move (shared and root entities, excluded files,
  // tests without a moving subject, assets).
  const vacated = new Set(moving.flatMap((entity) => [entity.original, ...(testsOf.get(entity.original) ?? [])]));
  const fixed = new Set(inventory.tracked.filter((file) => !vacated.has(file)).map(collisionKey));

  // Collisions: rename every moving member of a crowded path from its primary export, else prefix its feature.
  const crowd = new Map<string, number>();
  for (const entity of moving) crowd.set(collisionKey(entity.scrambled), (crowd.get(collisionKey(entity.scrambled)) ?? 0) + 1);
  for (const entity of moving) {
    const key = collisionKey(entity.scrambled);
    if ((crowd.get(key) ?? 0) + (fixed.has(key) ? 1 : 0) < 2) continue;
    const directory = path.posix.dirname(entity.scrambled);
    const symbol = primaryExport.get(entity.original);
    const stem = symbol && symbol !== 'default' ? kebab(symbol).replace(new RegExp(`-?${entity.type}$`, 'i'), '') : '';
    if (stem) entity.scrambled = `${directory}/${stem}${roleSuffix(entity.type)}${extensionOf(entity.original)}`;
    else {
      entity.scrambled = `${directory}/${entity.truth.replace(/\//g, '-')}.${path.posix.basename(entity.original)}`;
      entity.leaky = true;
    }
  }
  // What is still crowded gets a counter, first come first served (sorted by original path).
  const taken = new Set(fixed);
  for (const entity of moving) {
    let candidate = entity.scrambled;
    for (let count = 2; taken.has(collisionKey(candidate)); count++) {
      candidate = `${path.posix.dirname(entity.scrambled)}/${stemOf(entity.scrambled)}-${count}${extensionOf(entity.scrambled)}`;
      entity.leaky = true;
    }
    entity.scrambled = candidate;
    taken.add(collisionKey(candidate));
  }

  if (variant === 'H1') {
    // Opaque names: the type's initial and a hash of the original path, lengthened until the name is unique.
    const opaque = new Set(fixed);
    for (const entity of moving) {
      const hash = createHash('sha256').update(entity.original).digest('hex');
      const directory = path.posix.dirname(entity.scrambled);
      let length = 4;
      const nameOf = () => `${directory}/${entity.type[0]}-${hash.slice(0, length)}${roleSuffix(entity.type)}${extensionOf(entity.original)}`;
      while (opaque.has(collisionKey(nameOf()))) length += 2;
      entity.scrambled = nameOf();
      entity.leaky = false;
      opaque.add(collisionKey(entity.scrambled));
    }
  }

  const tests = new Map<string, Map<string, string>>();
  for (const entity of moving) {
    const own = testsOf.get(entity.original);
    if (!own) continue;
    const originalStem = stemOf(entity.original);
    tests.set(entity.original, new Map(own.map((test) => [test, `${path.posix.dirname(entity.scrambled)}/${stemOf(entity.scrambled)}${path.posix.basename(test).slice(originalStem.length)}`])));
  }
  for (const test of inventory.tests) {
    const reason = !test.subject ? 'test with no co-located subject' : tests.has(test.subject) ? `test (moves with ${test.subject})` : `test (its subject ${test.subject} stays)`;
    excluded.push({ path: test.path, reason });
  }
  for (const file of inventory.declarations) excluded.push({ path: file, reason: 'declaration file' });
  for (const file of inventory.outside) excluded.push({ path: file, reason: 'outside the module root' });
  excluded.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entities, excluded, tests };
}

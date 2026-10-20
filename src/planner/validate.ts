// The deterministic validator between Nemotron and the plan (plan §3.5 items 4–6): the repo's own vocabulary and the
// group-name rules, checkEdit (drops or repairs what the model got wrong), applyEdit (edit → Plan), validatePlan
// (issues + graph metrics) and rankCandidates. Nothing here calls a model, and every list comes out sorted.
import { displayPath, fileResolver, lowConfidenceNames } from './facts.js';
import { attestedSingular, naiveSingular, repoWords, wordsOf } from './facts-words.js';
import { planMetrics, plannedEdges } from './metrics.js';
import { groupKey, latestPlannerRules, type Confidence, type Draft, type Facts, type GroupKind, type Issue, type Placement, type Plan, type PlanEdit, type PlannerRules, type Validation } from './types.js';

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The repo's own words as it spells them: path segments and stems (movable and pinned files), exported symbols,
 * tables, routes. No guessed singulars: `redis` is a word, `redi` is not (checkName singularises against this set).
 */
export function vocabularyOf(facts: Facts): Set<string> {
  return new Set([...repoWords(facts)].sort(byCodeUnit));
}

const namePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// Junk drawers, and the layout's own words: never a module, and never a shared/platform concept either (`shared/shared`).
const junkWords = ['common', 'core', 'misc', 'general', 'helper', 'helpers', 'util', 'utils', 'lib', 'base', 'manager'];
const junkNames = [...junkWords, 'shared', 'platform', 'module', 'modules'];
const typeWords = ['controller', 'controllers', 'service', 'services', 'repository', 'repositories', 'dto', 'dtos', 'model', 'models',
  'entity', 'entities', 'type', 'types', 'interface', 'interfaces', 'middleware', 'middlewares', 'command', 'commands'];
export const bannedModuleNames = new Set([...junkNames, 'app', 'api', 'main', 'index', 'src', ...typeWords]);
// A platform concern is named for what it does (http, logging), never for a file type (`platform/middleware`).
const bannedConceptNames = new Set([...junkNames, ...typeWords]);
// Type words and plain junk words ban a compound name too (`common-util`, `user-controller`, `platform/app-repository`).
// The rest ban only the whole name: `shared-link`, `api-key` and ghostfolio's `base-currency` are features.
export const bannedWords = new Set(['common', 'misc', 'helper', 'util', 'lib', ...typeWords].map(naiveSingular));
// Plumbing words a shared/platform group may use even when the repo never says them.
const plumbingWords = new Set(['config', 'configuration', 'database', 'db', 'logger', 'logging', 'log', 'http', 'queue', 'job', 'telemetry',
  'metric', 'registry', 'bootstrap', 'event', 'cache', 'mail', 'email', 'storage', 'crypto', 'auth', 'security', 'validation', 'error',
  'environment', 'env', 'process', 'websocket', 'cron', 'schedule', 'health', 'maintenance', 'response', 'request', 'file', 'media', 'i18n']);

/** Seeds labels that name a place in the layout, not a feature. */
const nonDomainLabels = new Set(['shared', 'registry']);

/** shared/ is one flat folder of concept-named files (plan §2.2), so every shared file is in this one group. */
export const sharedGroupName = 'shared';

/** Roles that do I/O or need the framework, so they never belong in shared/ (pure code only). */
const impureRoles = new Set(['service', 'repository', 'controller', 'guard', 'interceptor', 'middleware', 'filter', 'gateway', 'processor', 'registry', 'command', 'module']);

/** The composition root: the one platform group for registries, the only folder R4's rules let import every module. */
export const registryGroup = 'platform/registry';

/**
 * A table that more than this many groups of a plan read or write is a hub (immich: asset in 22 groups, asset_exif in
 * 15, user in 14): two groups that both use it share nothing specific, so it is no evidence that they belong together.
 */
const hubTableGroups = 3;

function hubTables(facts: Facts, groupOf: ReadonlyMap<string, string>): Set<string> {
  const groupsOf = new Map<string, Set<string>>();
  for (const file of facts.files) {
    const group = groupOf.get(file.path);
    if (group === undefined) continue;
    for (const table of [...file.tables.reads, ...file.tables.writes]) groupsOf.set(table, (groupsOf.get(table) ?? new Set()).add(group));
  }
  return new Set([...groupsOf].filter(([, groups]) => groups.size > hubTableGroups).map(([table]) => table));
}

/** The group a name and kind denote: every shared name collapses to the one flat shared group. */
export const canonicalGroup = (name: string, kind: GroupKind) => ({ name: kind === 'shared' ? sharedGroupName : name, kind });

/**
 * Issues for a final group name (already without a `modules/`-style prefix): bare kebab case, no junk-drawer or type
 * word in it, and only the repo's own words (plus the plumbing list for shared/platform). The model never invents
 * terms. A plural word passes when the repo spells it, or spells its singular (`albums` for album, never `redi`).
 */
export function checkName(name: string, kind: GroupKind, vocabulary: ReadonlySet<string>): Issue[] {
  const group = groupKey({ kind, name });
  if (kind === 'shared') {
    return name === sharedGroupName ? [] : [{ severity: 'error', code: 'bad-name', group, detail: `shared/ is one flat folder; its group is shared/${sharedGroupName}, not "${name}"` }];
  }
  if (!namePattern.test(name)) return [{ severity: 'error', code: 'bad-name', group, detail: `"${name}" is not a bare kebab-case name` }];
  const banned = kind === 'module' ? bannedModuleNames : bannedConceptNames;
  const why = `a junk drawer or a type word, not ${kind === 'module' ? 'a feature' : `a ${kind} concept`}`;
  if (banned.has(name) || banned.has(naiveSingular(name))) return [{ severity: 'error', code: 'banned-name', group, detail: `"${name}" is ${why}` }];
  const bannedWord = wordsOf(name).find((word) => bannedWords.has(naiveSingular(word)));
  if (bannedWord) return [{ severity: 'error', code: 'banned-name', group, detail: `"${name}" contains "${bannedWord}": ${why}` }];
  const isWord = (word: string) => vocabulary.has(word) || (kind !== 'module' && plumbingWords.has(word));
  const foreign = [...new Set(wordsOf(name).map(attestedSingular(isWord)).filter((word) => !isWord(word)))];
  if (foreign.length) {
    const source = kind === 'module' ? "the repo's vocabulary" : "the repo's vocabulary or the plumbing list";
    return [{ severity: 'error', code: 'foreign-name', group, detail: `"${name}" uses words not in ${source}: ${foreign.join(', ')}` }];
  }
  return [];
}

/** `Modules/Album ` → album: trimmed, lowercased, without a leading `module(s)/`, `shared/` or `platform/`. */
const bareName = (name: string) => name.trim().toLowerCase().replace(/^(modules?|shared|platform)\//, '').trim();

/** Where a draft label lands when no group entry names it. */
const fallbackGroup = (label: string): { name: string; kind: GroupKind } =>
  ({ name: label, kind: label === 'shared' ? 'shared' : label === 'registry' ? 'platform' : 'module' });

/** G2 before G10. */
const byDraftId = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1)) || byCodeUnit(a, b);

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function sortIssues(issues: Issue[]): Issue[] {
  const severityOrder = (issue: Issue) => (issue.severity === 'error' ? 0 : 1);
  return issues.sort((a, b) => severityOrder(a) - severityOrder(b) || byCodeUnit(a.code, b.code) || byCodeUnit(a.group ?? '', b.group ?? '')
    || byCodeUnit(a.file ?? '', b.file ?? '') || byCodeUnit(a.detail, b.detail));
}

/**
 * Filters a model's draft edit. Dropped: entries for unknown draft ids, repeated entries for one id (the first wins),
 * moves of unknown or pinned files, repeated moves of one file (the first wins), and every entry or move whose name
 * fails checkName. A move names its file as the planner `rules` read it (fileResolver: rules 2 also read the ids the
 * edit prompt showed, `13` and `56(contested)`); a name of no movable file, or of more than one, is an unknown file.
 * Under rules 2 a move's target may also be a draft group's id or key (`G8`, `G8:custom-field`): that group's name and
 * kind in this edit. Repaired: one kind per name, taken from the first group entry carrying it in draft-id order, else
 * the first move. `accepted` is the edit as applied: one entry per draft group in draft-id order (unnamed or dropped
 * groups keep their draft label) and the surviving moves by path, each naming its file by package path.
 */
export function checkEdit(facts: Facts, draft: Draft, edit: PlanEdit, draftGroupIds: Map<string, string>, rules: PlannerRules = latestPlannerRules): { accepted: PlanEdit; issues: Issue[] } {
  const vocabulary = vocabularyOf(facts);
  const issues: Issue[] = [];
  const labelOf = new Map([...draftGroupIds].map(([label, id]) => [id, label]));

  const entryOf = new Map<string, { name: string; kind: GroupKind } | null>();
  for (const entry of edit.groups) {
    const label = labelOf.get(entry.draft);
    if (label === undefined) {
      issues.push({ severity: 'warning', code: 'unknown-draft-group', group: entry.draft, detail: `no draft group ${entry.draft}; entry "${entry.name}" dropped` });
      continue;
    }
    if (entryOf.has(entry.draft)) {
      // IssueCode has no duplicate-group code; a repeated entry is a second answer for an id that's already taken.
      issues.push({ severity: 'warning', code: 'duplicate-draft-group', group: entry.draft, detail: `${entry.draft} is named more than once; the first entry wins, "${entry.name}" dropped` });
      continue;
    }
    const { name } = canonicalGroup(bareName(entry.name), entry.kind);
    const problems = checkName(name, entry.kind, vocabulary);
    entryOf.set(entry.draft, problems.length ? null : { name, kind: entry.kind });
    const kept = groupKey(fallbackGroup(label));
    issues.push(...problems.map((issue) => ({ ...issue, detail: `${entry.draft} ("${label}") entry dropped, kept as ${kept}: ${issue.detail}` })));
  }

  const groups: PlanEdit['groups'] = [...labelOf].sort((a, b) => byDraftId(a[0], b[0])).map(([id, label]) => {
    const entry = entryOf.get(id);
    if (entry === undefined) {
      issues.push({ severity: 'warning', code: 'missing-draft-group', group: id, detail: `${id} ("${label}") has no entry; kept as ${groupKey(fallbackGroup(label))}` });
    }
    return { draft: id, ...(entry ?? fallbackGroup(label)) };
  });


  const pinned = new Set(facts.pins.map((pin) => pin.path));
  const filesNamed = fileResolver(facts, rules, lowConfidenceNames(draft));
  // Rules 2: a move's target may be a draft group as the prompt showed it, by its id (`G8`, as DRAFT GROUPS lists it) or
  // by its key (`G8:custom-field`, as the answer's own groups name it): that group as this edit names it (S7 bench:
  // kaneo's winning edit wrote 23 of its moves' targets as keys).
  const groupNamed = new Map(rules === 1 ? [] : groups.flatMap((group) => [[group.draft, group], [`${group.draft}:${labelOf.get(group.draft)}`, group]] as const));
  const movedFiles = new Set<string>();
  const moves: PlanEdit['moves'] = [];
  for (const move of edit.moves) {
    const named = filesNamed(move.file);
    if (named.length > 1) {
      issues.push({ severity: 'warning', code: 'unknown-file', detail: `${move.file} names ${named.length} movable files (${named.map((file) => file.path).join(', ')}); its move to "${move.to}" dropped` });
      continue;
    }
    const filePath = named[0]?.path ?? facts.pins.find((pin) => [pin.path, displayPath(facts, pin.path)].includes(move.file.trim()))?.path;
    if (filePath === undefined) {
      issues.push({ severity: 'warning', code: 'unknown-file', detail: `no movable file ${move.file}; its move to "${move.to}" dropped` });
      continue;
    }
    if (pinned.has(filePath)) {
      issues.push({ severity: 'error', code: 'pinned-file', file: filePath, detail: `${filePath} is pinned; its move to "${move.to}" dropped` });
      continue;
    }
    if (movedFiles.has(filePath)) {
      issues.push({ severity: 'warning', code: 'duplicate-move', file: filePath, detail: `${filePath} is moved more than once; the first move wins, "${move.to}" dropped` });
      continue;
    }
    movedFiles.add(filePath);
    const group = groupNamed.get(move.to.trim());
    const kind = group?.kind ?? move.kind;
    const { name } = group ?? canonicalGroup(bareName(move.to), kind);
    const problems = checkName(name, kind, vocabulary);
    if (problems.length) {
      issues.push(...problems.map((issue) => ({ ...issue, file: filePath, detail: `move of ${filePath} dropped: ${issue.detail}` })));
      continue;
    }
    moves.push({ file: filePath, to: name, kind, rationale: move.rationale });
  }

  const kindOfName = new Map<string, GroupKind>();
  for (const { name, kind } of [...groups, ...moves.map((move) => ({ name: move.to, kind: move.kind }))]) if (!kindOfName.has(name)) kindOfName.set(name, kind);
  for (const group of groups) {
    const kind = kindOfName.get(group.name)!;
    if (group.kind === kind) continue;
    issues.push({ severity: 'error', code: 'kind-conflict', group: groupKey(group), detail: `${group.draft} makes "${group.name}" a ${group.kind}, but it is a ${kind} group; kept as ${kind}` });
    group.kind = kind;
  }
  for (const move of moves) {
    const kind = kindOfName.get(move.to)!;
    if (move.kind === kind) continue;
    const filePath = move.file;
    issues.push({ severity: 'error', code: 'kind-conflict', group: groupKey({ kind: move.kind, name: move.to }), file: filePath,
      detail: `the move of ${filePath} makes "${move.to}" a ${move.kind}, but it is a ${kind} group; kept as ${kind}` });
    move.kind = kind;
  }

  return { accepted: { groups, moves: moves.sort((a, b) => byCodeUnit(a.file, b.file)) }, issues: sortIssues(issues) };
}

const unsureConfidences = new Set<Confidence>(['contested', 'propagated-weak', 'isolated']);

/**
 * The plan an accepted edit describes: each draft group under its entry's name and kind (equal names merge; a group
 * without an entry keeps its draft label), then the moves on top. Moved files carry the planner's rationale.
 */
export function applyEdit(facts: Facts, draft: Draft, accepted: PlanEdit, draftGroupIds: Map<string, string>): Plan {
  const finalOf = new Map<string, { name: string; kind: GroupKind }>();
  for (const entry of accepted.groups) if (!finalOf.has(entry.draft)) finalOf.set(entry.draft, { name: entry.name, kind: entry.kind });
  const moveOf = new Map<string, PlanEdit['moves'][number]>();
  for (const move of accepted.moves) if (!moveOf.has(move.file)) moveOf.set(move.file, move);

  const placements = facts.files.map((file): Placement => {
    const label = draft.assignment.get(file.path);
    const confidence = draft.confidence.get(file.path);
    if (label === undefined || confidence === undefined) throw new Error(`the draft has no label for ${file.path}`);
    const draftId = draftGroupIds.get(label);
    const named = (draftId === undefined ? undefined : finalOf.get(draftId)) ?? fallbackGroup(label);
    const unsure = unsureConfidences.has(confidence);
    const move = moveOf.get(file.path);
    if (!move) return { path: file.path, kind: named.kind, name: named.name, confidence, contested: unsure, source: 'draft' };
    // A move into the group the file lands in anyway changes nothing, so it isn't the planner's placement.
    if (groupKey({ kind: move.kind, name: move.to }) === groupKey(named)) return { path: file.path, kind: named.kind, name: named.name, confidence, contested: unsure, source: 'draft' };
    return { path: file.path, kind: move.kind, name: move.to, confidence, contested: true, source: 'planner', rationale: move.rationale };
  });
  return { placements: placements.sort((a, b) => byCodeUnit(a.path, b.path)) };
}

/** Issues and metrics for a complete plan; valid means no error issue. Warnings are findings for plan.md. */
export function validatePlan(facts: Facts, draft: Draft, plan: Plan): Validation {
  const vocabulary = vocabularyOf(facts);
  const issues: Issue[] = [];
  const fileByPath = new Map(facts.files.map((file) => [file.path, file]));
  const pinned = new Set(facts.pins.map((pin) => pin.path));

  const planned = new Map<string, Placement>();
  for (const placement of plan.placements) {
    const group = groupKey(placement);
    if (pinned.has(placement.path)) issues.push({ severity: 'error', code: 'pinned-file', file: placement.path, group, detail: `${placement.path} is pinned and can't be placed` });
    else if (!fileByPath.has(placement.path)) issues.push({ severity: 'error', code: 'unknown-file', file: placement.path, group, detail: `${placement.path} is not a movable file` });
    else if (planned.has(placement.path)) {
      issues.push({ severity: 'error', code: 'duplicate-file', file: placement.path, group, detail: `${placement.path} is placed again; first placed in ${groupKey(planned.get(placement.path)!)}` });
    } else planned.set(placement.path, placement);
  }
  for (const file of facts.files) {
    if (!planned.has(file.path)) issues.push({ severity: 'error', code: 'missing-file', file: file.path, detail: `${file.path} has no placement` });
  }
  const placements = [...planned.values()].sort((a, b) => byCodeUnit(a.path, b.path));

  const members = new Map<string, Placement[]>();
  for (const placement of placements) pushTo(members, groupKey(placement), placement);
  const groups = [...members.keys()].sort(byCodeUnit);
  const kindsOfName = new Map<string, string[]>();
  for (const group of groups) {
    const { name, kind } = members.get(group)![0]!;
    issues.push(...checkName(name, kind, vocabulary));
    pushTo(kindsOfName, name, group);
  }
  for (const [name, keys] of kindsOfName) {
    for (const group of keys.slice(1)) issues.push({ severity: 'error', code: 'kind-conflict', group, detail: `"${name}" is also ${keys[0]}` });
  }

  for (const group of groups) {
    const groupMembers = members.get(group)!;
    // A one-file module is suspicious; a one-file platform concern (cron, crypto) is ordinary plumbing. Basename
    // collisions aren't issues: the step generator keeps colliding files in their old parent folder's name.
    if (groupMembers.length === 1 && group.startsWith('module/')) {
      issues.push({ severity: 'warning', code: 'singleton-group', group, file: groupMembers[0]!.path, detail: `${group} holds one file` });
    }
  }
  // A platform group holding a registry is the composition root, so it holds registries only (S5: the critic cleared
  // two impure-shared warnings by putting app.repository and api.service in platform/registry).
  const registryGroups = new Set(placements.filter((placement) => placement.kind === 'platform' && fileByPath.get(placement.path)!.role === 'registry').map(groupKey));
  for (const placement of placements) {
    const { role, routes, tables } = fileByPath.get(placement.path)!;
    if (registryGroups.has(groupKey(placement)) && role !== 'registry') {
      issues.push({ severity: 'warning', code: 'impure-registry', group: groupKey(placement), file: placement.path,
        detail: `${placement.path} (${role}) is no registry; ${groupKey(placement)} holds registries (composition roots) only` });
    }
    if (placement.kind === 'shared' && impureRoles.has(role)) {
      issues.push({ severity: 'warning', code: 'impure-shared', group: groupKey(placement), file: placement.path, detail: `${placement.path} is a ${role}; shared/ holds pure code only` });
    }
    if (placement.kind === 'platform' && (role === 'controller' || routes.length || tables.writes.length)) {
      const what = role === 'controller' || routes.length ? `serves routes${routes.length ? ` (${routes.join(', ')})` : ''}` : `writes tables (${tables.writes.join(', ')})`;
      issues.push({ severity: 'warning', code: 'platform-feature', group: groupKey(placement), file: placement.path, detail: `${placement.path} ${what}: a feature, not plumbing` });
    }
    if (role === 'registry' && placement.kind !== 'platform') {
      issues.push({ severity: 'warning', code: 'registry-outside-platform', group: groupKey(placement), file: placement.path, detail: `${placement.path} is a registry (a composition root) outside platform/` });
    } else if (role === 'registry' && groupKey(placement) !== registryGroup) {
      // S6 review: the gate took a critic move of commands/index.ts into a new one-file platform/cli (one-file-platform
      // exempts registries), and R4 exempts only this one composition root.
      issues.push({ severity: 'warning', code: 'registry-outside-root', group: groupKey(placement), file: placement.path, detail: `${placement.path} is a registry outside ${registryGroup}, the composition root` });
    }
  }

  const groupOf = new Map(placements.map((placement) => [placement.path, groupKey(placement)]));
  const edges = plannedEdges(facts.edges, groupOf);
  // A module or platform name that is another one of its kind plus suffix words (asset-media, http-response next to http).
  for (const kind of ['module', 'platform'] as const) {
    const ofKind = groups.filter((group) => group.startsWith(`${kind}/`));
    for (const child of ofKind) {
      const parent = ofKind.filter((group) => child.startsWith(`${group}-`)).sort((a, b) => b.length - a.length)[0];
      if (!parent) continue;
      const count = (from: string, to: string) => edges.filter((edge) => groupOf.get(edge.from) === from && groupOf.get(edge.to) === to).length;
      const up = count(child, parent);
      const down = count(parent, child);
      issues.push({ severity: 'warning', code: 'sub-feature', group: child,
        detail: `${child} extends ${parent}: ${up + down} edges between them (${up} ${child} → ${parent}, ${down} back)` });
    }
  }

  // platform holds plumbing that features share. A one-file concern that fewer than two other groups use (registry
  // wiring aside) is a fold candidate: into its one consumer, or into the concern or feature it serves (S5's plan:
  // hls, transcoding, mail, check). A composition root is used by no feature, and is no candidate.
  const registries = new Set(facts.files.filter((file) => file.role === 'registry').map((file) => file.path));
  for (const group of groups) {
    const groupMembers = members.get(group)!;
    const file = groupMembers[0]!.path;
    if (!group.startsWith('platform/') || groupMembers.length !== 1 || registries.has(file)) continue;
    const consumers = [...new Set(edges.filter((edge) => edge.to === file && !registries.has(edge.from)).map((edge) => groupOf.get(edge.from)!))]
      .filter((consumer) => consumer !== group).sort(byCodeUnit);
    if (consumers.length >= 2) continue;
    const fold = consumers.length ? `only ${consumers[0]} uses it: consider folding it there` : 'no other planned group uses it: consider folding it into the concern or feature it serves';
    issues.push({ severity: 'warning', code: 'one-file-platform', group, file, detail: `${group} holds one file, and ${fold}` });
  }

  // shared/ holds code that at least two modules use (plan §2.2, the layout text the planner reads): a shared file that
  // exactly one other group uses belongs in that group. One used by none (only pinned code) has no better home.
  for (const placement of placements) {
    if (placement.kind !== 'shared') continue;
    const consumers = [...new Set(edges.filter((edge) => edge.to === placement.path && !registries.has(edge.from)).map((edge) => groupOf.get(edge.from)!))]
      .filter((consumer) => consumer !== groupKey(placement));
    if (consumers.length !== 1) continue;
    issues.push({ severity: 'warning', code: 'single-consumer-shared', group: groupKey(placement), file: placement.path,
      detail: `${placement.path} is in shared/, but only ${consumers[0]} uses it: it belongs there` });
  }

  // A draft group merged under a name that shares none of its words, with no edge to the rest of the group and no table
  // (hubs aside) or route prefix in common with it, has no evidence for the merge (S5: a sample that named groups by
  // misread ids merged machine-learning into user).
  const hubs = hubTables(facts, groupOf);
  const dataOf = (paths: Iterable<string>) => new Set([...paths].flatMap((path) => {
    const { tables, routes } = fileByPath.get(path)!;
    return [...tables.reads, ...tables.writes].filter((table) => !hubs.has(table)).map((table) => `table ${table}`).concat(routes.map((route) => `route ${route}`));
  }));
  for (const group of groups) {
    const groupMembers = members.get(group)!;
    const nameWords = new Set(wordsOf(groupMembers[0]!.name).map(naiveSingular));
    const merged = new Map<string, Set<string>>();
    for (const placement of groupMembers) {
      const label = draft.assignment.get(placement.path)!;
      if (placement.source !== 'draft' || nonDomainLabels.has(label) || wordsOf(label).map(naiveSingular).some((word) => nameWords.has(word))) continue;
      if (!merged.has(label)) merged.set(label, new Set());
      merged.get(label)!.add(placement.path);
    }
    for (const [label, files] of merged) {
      const linked = edges.some((edge) => (files.has(edge.from) && !files.has(edge.to) && groupOf.get(edge.to) === group)
        || (files.has(edge.to) && !files.has(edge.from) && groupOf.get(edge.from) === group));
      const restData = dataOf(groupMembers.map((placement) => placement.path).filter((path) => !files.has(path)));
      const sharesData = [...dataOf(files)].some((item) => restData.has(item));
      if (!linked && !sharesData && files.size < groupMembers.length) {
        issues.push({ severity: 'warning', code: 'unsupported-merge', group, detail: `${group} takes draft group "${label}" (${[...files].join(', ')}): no shared word, edge, table or route` });
      }
    }
  }

  const sorted = sortIssues(issues);
  return { valid: !sorted.some((issue) => issue.severity === 'error'), issues: sorted, metrics: planMetrics(facts, draft, placements) };
}

/**
 * What links `files` to the files of group `target` beyond a shared word: edges between them (registry wiring aside),
 * and tables (hubs aside) or route prefixes both use. File roles are no evidence: every feature has a service.
 */
function linkEvidence(facts: Facts, plan: Plan, files: ReadonlySet<string>, target: string): { edges: number; tables: string[]; routes: string[] } {
  const groupOf = new Map(plan.placements.map((placement) => [placement.path, groupKey(placement)]));
  const registries = new Set(facts.files.filter((file) => file.role === 'registry').map((file) => file.path));
  const inTarget = (path: string) => !files.has(path) && groupOf.get(path) === target;
  const edges = plannedEdges(facts.edges, groupOf).filter((edge) => !registries.has(edge.from) && !registries.has(edge.to)
    && ((files.has(edge.from) && inTarget(edge.to)) || (files.has(edge.to) && inTarget(edge.from)))).length;
  const hubs = hubTables(facts, groupOf);
  const shared = (of: (file: Facts['files'][number]) => string[]) => {
    const used = new Set(facts.files.filter((file) => inTarget(file.path)).flatMap(of));
    return [...new Set(facts.files.filter((file) => files.has(file.path)).flatMap(of))].filter((item) => used.has(item)).sort(byCodeUnit);
  };
  return { edges, tables: shared((file) => [...file.tables.reads, ...file.tables.writes]).filter((table) => !hubs.has(table)), routes: shared((file) => file.routes) };
}

/**
 * What links two groups of a plan, which a critic merge needs (S5: the critic merged EXIF metadata into
 * system-metadata on the word "metadata" alone; S6: module/stack into module/album on the hub table asset).
 */
export function mergeEvidence(facts: Facts, plan: Plan, source: string, target: string): { edges: number; tables: string[]; routes: string[] } {
  return linkEvidence(facts, plan, new Set(plan.placements.filter((placement) => groupKey(placement) === source).map((placement) => placement.path)), target);
}

/** What links one file to the files of group `target`, which a critic move into an existing group needs. */
export function moveEvidence(facts: Facts, plan: Plan, file: string, target: string): { edges: number; tables: string[]; routes: string[] } {
  return linkEvidence(facts, plan, new Set([file]), target);
}

/**
 * Best candidate first. Picking a plan without ground truth is an open problem: G1 showed TurboMQ alone ranks the
 * unedited draft (or the least-edited sample) first on immich, and S5 saw it again. The validator's warnings encode
 * the layout rules (singletons, sub-features, impure shared or registry groups, features in platform, registries
 * outside platform, one-file platform concerns and shared files that one group alone uses), so among valid plans that
 * keep at least `turboMqFloor` of the baseline's TurboMQ (a guard against one merged lump), the plan with the fewest
 * warnings wins; then TurboMQ, cycles and label. plan.md lists every candidate.
 *
 * Planner rules 2 put one key before all of these: a plan with at least one feature module before a plan with none.
 * A plan of platform and shared groups only moves nothing into a feature, so it is no answer to the task, and no
 * validity, warning count or TurboMQ can make it win while another candidate has a module (S7: ghostfolio's winner had
 * 44 groups and 0 modules). The key goes before validity too: an invalid plan with modules fails closed (it has no
 * steps, so `ac run` stops on it, and plan.md lists its errors in an editable plan.yaml), while a valid plan without
 * modules would be executed and certified as if it were the answer.
 */
export function rankCandidates<T extends { label: string; validation: Validation }>(candidates: T[], baselineTurboMqSum = 0, rules: PlannerRules = latestPlannerRules): T[] {
  const count = (candidate: T, severity: Issue['severity']) => candidate.validation.issues.filter((issue) => issue.severity === severity).length;
  const cohesive = (candidate: T) => Number(candidate.validation.metrics.turboMqSum >= turboMqFloor * baselineTurboMqSum);
  const featured = (candidate: T) => Number(rules !== 1 && candidate.validation.metrics.modules > 0);
  return [...candidates].sort((a, b) => featured(b) - featured(a) || Number(b.validation.valid) - Number(a.validation.valid) || count(a, 'error') - count(b, 'error')
    || cohesive(b) - cohesive(a) || count(a, 'warning') - count(b, 'warning')
    || b.validation.metrics.turboMqSum - a.validation.metrics.turboMqSum || a.validation.metrics.groupsInCycles - b.validation.metrics.groupsInCycles
    || byCodeUnit(a.label, b.label));
}

/** Share of the baseline's TurboMQ sum a candidate must keep to be ranked on its warnings. */
export const turboMqFloor = 0.9;

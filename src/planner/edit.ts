// The draft editor (plan §3.5 item 3, G1's v1): Nemotron names, merges and kinds the seeds draft's groups and moves
// only misplaced files, each with a rationale. It never lists every file, so coverage holds by construction.
// The evaluate round stays off (G1: it hurt 6 of 17 samples). K candidates come from one call with n=K.
import { z } from 'zod';
import { GatewayError, type CassetteMode, type Gateway, type ModelKey, type TemplateKwargs } from '../gateway/types.js';
import { displayPath, lowConfidenceName } from './facts.js';
import { latestPlannerRules, plannerRulesVersions, type Draft, type Facts, type PlanEdit, type PlannerRules, type RecordingPins } from './types.js';
import { bannedModuleNames, bannedWords, sharedGroupName } from './validate.js';


const groupKinds = ['module', 'shared', 'platform'] as const;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const layoutText = `Target layout:
- modules/<name>: one per business feature. <name> is a singular kebab-case domain noun spelled exactly as the repo spells it (route prefixes, table names, file stems): never abbreviated (sysmeta), never a synonym (configuration for config, db for database, metrics for telemetry), never invented.
- shared/: one flat folder of pure code (no I/O, no framework; never services, repositories, controllers, guards or interceptors) used by at least two modules. Files keep their names, so every shared group is named "${sharedGroupName}".
- platform/<concern>: plumbing such as config, database client, logging, generic HTTP middleware, queue, mail transport, telemetry, and composition roots (DI registries, the root application module, route tables). <concern> is the repo's word for the concern, never "platform".
Banned module names: ${[...bannedModuleNames].join(', ')}. No name of any kind contains these words: ${[...bannedWords].join(', ')}.`;

export const placementRules = `- Files that import each other heavily belong together; a file used by only one module belongs inside that module, not in shared/.
- Tables a file reads or writes are strong evidence for its feature; the module that writes a table usually owns it.
- Draft groups named after a technical word, a verb, or a single file are usually wrong: merge them into the feature they serve, or make plumbing a platform group.
- Admin, public and per-user variants of a feature (auth-admin, user-admin, config-public) belong to that feature's module.
- A group whose name extends another group's name with a suffix (asset-media and asset-file next to asset) is a sub-feature: merge it into the parent unless it owns its own tables and routes and barely depends on the parent.
- Controllers and CLI commands are a feature's entry points: they go to the feature they drive.
- platform holds plumbing that every feature uses; a group that writes its own tables or serves routes is a feature module.
- Registries (role "registry") and the root application module are composition roots: platform.
- There is no "app" module: the application shell's files go to platform (bootstrap, HTTP plumbing) or to the feature they serve.`;

const systemPrompt = `You are a senior software architect restructuring a TypeScript backend that is sliced by technical type (controllers/, services/, repositories/, dtos/ ...) into feature modules. You only draw the map: which group each file belongs to. Code is moved later by a deterministic tool, and every move is certified.

${layoutText}

You receive per-file facts and a DRAFT: groups G1..Gn produced deterministically from name tokens and label propagation. You edit the draft; you do not re-list files.

Output:
- "groups": one key per draft group ("<id>:<label>", e.g. "G18:album"), each {name, kind}: that group's final bare name (e.g. "album", "database"; no "modules/" prefix) and kind. Give two or more draft groups the same name to merge them.
- "moves": only files whose draft group is wrong: the file's path exactly as FILES lists it, the final group name and kind it belongs to (an existing final name or a new one), and a one-line rationale. Use moves to split a draft group or rescue misplaced files. Files not listed stay with their draft group.

Rules:
${placementRules}
- Low-confidence draft files are listed; decide each one (move it, or leave it if the draft is right).`;

const groupEntrySchema = {
  type: 'object',
  properties: { name: { type: 'string' }, kind: { type: 'string', enum: groupKinds } },
  required: ['name', 'kind'],
  additionalProperties: false,
};

/**
 * `groups` has one required key per draft group, so strict decoding can't skip a group (S5's first Ultra sample left 26
 * of 81 unnamed). Each key carries the group's label (`G66:machine-learning`): with bare ids, a sample named groups
 * off by a few ids (machine-learning and sync-checkpoint merged into user).
 */
const groupKeyOf = (id: string, label: string) => `${id}:${label}`;

const editSchema = (keys: string[]) => ({
  type: 'object',
  properties: {
    groups: {
      type: 'object',
      properties: Object.fromEntries(keys.map((key) => [key, groupEntrySchema])),
      required: keys,
      additionalProperties: false,
    },
    moves: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, to: { type: 'string' }, kind: { type: 'string', enum: groupKinds }, rationale: { type: 'string' } },
        required: ['file', 'to', 'kind', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups', 'moves'],
  additionalProperties: false,
});

const editValue = z.object({
  groups: z.record(z.string(), z.object({ name: z.string(), kind: z.enum(groupKinds) })),
  moves: z.array(z.object({ file: z.string(), to: z.string(), kind: z.enum(groupKinds), rationale: z.string() })),
});

/** The model's answer as a PlanEdit: group entries in draft-id order, keys back to bare ids. */
function planEditOf(value: z.infer<typeof editValue>, keys: string[]): PlanEdit {
  const known = keys.filter((key) => key in value.groups);
  const extra = Object.keys(value.groups).filter((key) => !keys.includes(key)).sort(byCodeUnit);
  return { groups: [...known, ...extra].map((key) => ({ draft: key.split(':')[0]!, ...value.groups[key]! })), moves: value.moves };
}



/** One line per movable file: `id path role L<loc> ex:… tbl:r[…]w[…] rt:… →ids` (~ marks a type-only edge). */
export function factsText(facts: Facts): string {
  const idOf = new Map(facts.files.map((file) => [file.path, file.id]));
  const outgoing = new Map<string, string[]>();
  for (const edge of facts.edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), `${edge.typeOnly ? '~' : ''}${idOf.get(edge.to)}`]);
  const lines = facts.files.map((file) => {
    const exportsText = file.exports.length ? ` ex:${file.exports.slice(0, 4).join(',')}${file.exports.length > 4 ? `,+${file.exports.length - 4}` : ''}` : '';
    const { reads, writes } = file.tables;
    const tablesText = reads.length || writes.length ? ` tbl:${reads.length ? `r[${reads.join(',')}]` : ''}${writes.length ? `w[${writes.join(',')}]` : ''}` : '';
    const routesText = file.routes.length ? ` rt:${file.routes.join(',')}` : '';
    const imports = outgoing.get(file.path)?.length ? ` →${outgoing.get(file.path)!.join(',')}` : '';
    return `${file.id} ${displayPath(facts, file.path)} ${file.role} L${file.loc}${exportsText}${tablesText}${routesText}${imports}`;
  });
  return `FILES under ${facts.moduleRoot || '.'}/ (id path role L<lines> ex:<exports> tbl:r[read tables]w[written tables] rt:<route prefixes> →<file ids it uses; ~ = type-only>)\n${lines.join('\n')}`;
}

/** Draft labels as G1..Gn, largest first, then by label. */
export function draftGroupIds(facts: Facts, draft: Draft): Map<string, string> {
  const sizes = new Map<string, number>();
  for (const file of facts.files) {
    const label = draft.assignment.get(file.path)!;
    sizes.set(label, (sizes.get(label) ?? 0) + 1);
  }
  const labels = [...sizes.keys()].sort((a, b) => sizes.get(b)! - sizes.get(a)! || byCodeUnit(a, b));
  return new Map(labels.map((label, index) => [label, `G${index + 1}`]));
}

/** Seeds labels that name a role in the layout, not a feature. */
const nonDomainLabels = new Set(['shared', 'registry']);

/** Pairs of draft groups where one label extends the other (`asset-media` → `asset`), with the edges between them. */
export function subFeatureHints(facts: Facts, draft: Draft, groupIds: Map<string, string>): string[] {
  const labels = [...groupIds.keys()];
  const domains = labels.filter((label) => !nonDomainLabels.has(label));
  const hints: string[] = [];
  for (const child of domains) {
    const parent = domains.filter((label) => child.startsWith(`${label}-`)).sort((a, b) => b.length - a.length)[0];
    if (!parent) continue;
    const edges = facts.edges.filter((edge) => {
      const ends = [draft.assignment.get(edge.from), draft.assignment.get(edge.to)];
      return ends.includes(child) && ends.includes(parent);
    }).length;
    hints.push(`${groupIds.get(child)} "${child}" extends ${groupIds.get(parent)} "${parent}" (${edges} edges between them)`);
  }
  return hints;
}

/** `purposes`: one-line purposes of low-confidence files (summaries.ts), listed after them; none leaves the text as before. */
export function draftText(facts: Facts, draft: Draft, groupIds: Map<string, string>, purposes: ReadonlyMap<string, string> = new Map()): string {
  const idOf = new Map(facts.files.map((file) => [file.path, file.id]));
  const members = new Map<string, number[]>();
  for (const file of facts.files) {
    const label = draft.assignment.get(file.path)!;
    members.set(label, [...(members.get(label) ?? []), file.id]);
  }
  const groups = [...groupIds].map(([label, id]) => `${id} "${label}": ${members.get(label)!.join(',')}`);
  const lowConfidence = draft.contested.map((path) => lowConfidenceName(idOf.get(path)!, draft.confidence.get(path)!));
  const hints = subFeatureHints(facts, draft, groupIds);
  const purposeLines = draft.contested.filter((path) => purposes.has(path)).map((path) => `${idOf.get(path)} ${displayPath(facts, path)}: ${purposes.get(path)}`);
  return [
    `DRAFT GROUPS (id "label": file ids)\n${groups.join('\n')}`,
    `DRAFT LOW-CONFIDENCE FILES\n${lowConfidence.join(' ') || '(none)'}`,
    ...(purposeLines.length ? [`LOW-CONFIDENCE FILE PURPOSES (one line per file from a smaller model that read its source: a hint, not a fact)\n${purposeLines.join('\n')}`] : []),
    ...(hints.length ? [`SUB-FEATURE CANDIDATES\n${hints.join('\n')}`] : []),
    `PINNED (never moved, not listed above): ${facts.pins.length} files`,
  ].join('\n\n');
}

export interface EditPrompt {
  system: string;
  user: string;
  groupIds: Map<string, string>;
}

export function editPrompt(facts: Facts, draft: Draft, purposes?: ReadonlyMap<string, string>): EditPrompt {
  const groupIds = draftGroupIds(facts, draft);
  return { system: systemPrompt, user: `${factsText(facts)}\n\n${draftText(facts, draft, groupIds, purposes)}`, groupIds };
}

export interface EditSettings {
  model: ModelKey;
  templateKwargs: TemplateKwargs;
  samples: number;
  maxTokens: number;
  /** How the planner reads the edits (and the critic's moves) and ranks them; no part of any request (types.ts PlannerRules). */
  rules: PlannerRules;
}

/** Ultra on medium_effort (G1's best editor), thinking on, K=3, the latest planner rules. */
export const defaultEditSettings: EditSettings = { model: 'ultra', templateKwargs: { medium_effort: true }, samples: 3, maxTokens: 64_000, rules: latestPlannerRules };

/**
 * The edit settings for a target and the cassette mode its calls go through, like criticSettingsFor: a replay reads
 * the answers with the planner rules the profile pins (`plan.rules`), so a plan recorded under older rules replays
 * from its cassette as it was made (profiles/immich.json pins 1, the S6 recording's). Anything that may record (record,
 * and auto) uses the latest rules: the pin belongs to the recording, not to the target.
 */
export function editSettingsFor(profile: RecordingPins | null | undefined, mode: CassetteMode): EditSettings {
  const pinned = profile?.plan?.rules;
  if (pinned === undefined) return defaultEditSettings;
  const version = plannerRulesVersions.find((candidate) => candidate === pinned);
  if (version === undefined) throw new Error(`no planner rules version ${pinned} (versions: ${plannerRulesVersions.join(', ')})`);
  return mode === 'replay' ? { ...defaultEditSettings, rules: version } : defaultEditSettings;
}

export interface EditCandidate {
  label: string;
  edit?: PlanEdit;
  error?: string;
  reasoningChars: number;
}

export interface EditRun {
  candidates: EditCandidate[];
  /** 'n' when one call returned the K choices, 'sequential' when the model refused n>1. */
  sampling: 'n' | 'sequential';
  costUsd: number;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number };
  calls: number;
}

const refusesN = (error: unknown) => error instanceof GatewayError && error.code === 'http' && error.status === 400 && /\bn\b/.test(error.message);

/** K candidate edits: one call with n=K, or K sequential calls when the model rejects n>1 (a recorded 400). */
export async function runEdit(gateway: Gateway, prompt: EditPrompt, settings: EditSettings = defaultEditSettings): Promise<EditRun> {
  const groupKeys = [...prompt.groupIds].map(([label, id]) => groupKeyOf(id, label));
  const request = {
    model: settings.model,
    messages: [{ role: 'system' as const, content: prompt.system }, { role: 'user' as const, content: prompt.user }],
    schemaName: 'plan_edit',
    schema: editSchema(groupKeys),
    parse: (value: unknown): PlanEdit => planEditOf(editValue.parse(value), groupKeys),
    maxTokens: settings.maxTokens,
    templateKwargs: settings.templateKwargs,
  };
  const run: EditRun = { candidates: [], sampling: 'n', costUsd: 0, usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 }, calls: 0 };
  const collect = (result: Awaited<ReturnType<typeof gateway.structured<PlanEdit>>>) => {
    run.calls++;
    run.costUsd += result.costUsd;
    run.usage.promptTokens += result.usage?.promptTokens ?? 0;
    run.usage.completionTokens += result.usage?.completionTokens ?? 0;
    run.usage.reasoningTokens += result.usage?.reasoningTokens ?? 0;
    for (const choice of result.choices) {
      const label = `${settings.model}#${run.candidates.length + 1}`;
      run.candidates.push({ label, reasoningChars: choice.reasoning?.length ?? 0, ...(choice.value ? { edit: choice.value } : { error: choice.error ?? 'no value' }) });
    }
  };
  if (settings.samples > 1) {
    try {
      collect(await gateway.structured({ ...request, n: settings.samples }));
      return run;
    } catch (error) {
      if (!refusesN(error)) throw error;
      run.sampling = 'sequential';
    }
  }
  for (let sample = 0; sample < settings.samples; sample++) collect(await gateway.structured(request));
  return run;
}

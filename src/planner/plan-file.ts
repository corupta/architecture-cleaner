// plan.yaml: the editable plan between `ac plan` and `ac steps` (plan §3.5 item 6). One line per file, so a human
// moves a file by moving its line and renames a group by editing its key. Tests listed with a file move with it.
import { parse } from 'yaml';
import { z } from 'zod';
import { groupKey, type Confidence, type Facts, type GroupKind, type Pin, type Plan, type PlacementSource } from './types.js';

const kindOrder: GroupKind[] = ['module', 'platform', 'shared'];
const confidences = ['seed', 'propagated-strong', 'propagated-weak', 'contested', 'isolated'] as const;
const sources = ['draft', 'planner', 'critic', 'human'] as const;

export interface PlanFileEntry {
  path: string;
  tests: string[];
  confidence?: Confidence;
  contested?: boolean;
  source?: PlacementSource;
  rationale?: string;
}

export interface PlanFile {
  packageRoot: string;
  moduleRoot: string;
  sha: string;
  /** `kind/name` → files, in file order. */
  groups: Map<string, PlanFileEntry[]>;
  pinned: Pin[];
}

// `@` can't start a plain scalar (a reserved indicator), and `.inf`/`.nan` read back as numbers.
const plainScalar = /^[A-Za-z0-9_./][A-Za-z0-9_./@+-]*$/;
const reservedScalar = /^(true|false|yes|no|on|off|null|~|y|n|[-+]?(\d|\.\d).*|\.(inf|nan))$/i;
/** A YAML flow scalar: plain when unambiguous, else a JSON string (valid YAML double-quoted). */
const scalar = (text: string) => (plainScalar.test(text) && !reservedScalar.test(text) ? text : JSON.stringify(text));

function entryLine(entry: PlanFileEntry): string {
  const fields = [`path: ${scalar(entry.path)}`];
  if (entry.tests.length) fields.push(`tests: [${entry.tests.map(scalar).join(', ')}]`);
  if (entry.confidence) fields.push(`confidence: ${entry.confidence}`);
  if (entry.contested) fields.push('contested: true');
  if (entry.source && entry.source !== 'draft') fields.push(`source: ${entry.source}`);
  if (entry.rationale) fields.push(`rationale: ${JSON.stringify(entry.rationale)}`);
  return `    - { ${fields.join(', ')} }`;
}

const compareGroupKeys = (a: string, b: string) => {
  const [kindA, nameA] = a.split('/') as [GroupKind, string];
  const [kindB, nameB] = b.split('/') as [GroupKind, string];
  return kindOrder.indexOf(kindA) - kindOrder.indexOf(kindB) || (nameA < nameB ? -1 : nameA > nameB ? 1 : 0);
};

export function planFileOf(facts: Facts, plan: Plan): PlanFile {
  const testsOf = new Map(facts.files.map((file) => [file.path, file.tests]));
  const groups = new Map<string, PlanFileEntry[]>();
  for (const placement of plan.placements) {
    const entry: PlanFileEntry = {
      path: placement.path,
      tests: testsOf.get(placement.path) ?? [],
      confidence: placement.confidence,
      contested: placement.contested,
      source: placement.source,
      ...(placement.rationale ? { rationale: placement.rationale } : {}),
    };
    groups.set(groupKey(placement), [...(groups.get(groupKey(placement)) ?? []), entry]);
  }
  const sorted = new Map([...groups].sort((a, b) => compareGroupKeys(a[0], b[0])).map(([key, entries]) => [key, entries.sort((a, b) => (a.path < b.path ? -1 : 1))]));
  return { packageRoot: facts.packageRoot, moduleRoot: facts.moduleRoot, sha: facts.sha, groups: sorted, pinned: facts.pins };
}

/** Where a candidate's plan is written next to plan.yaml: `seeds draft` → candidates/seeds-draft.yaml, `ultra#2` → candidates/ultra-2.yaml. */
export const candidateFileName = (label: string) => `candidates/${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.yaml`;

export function writePlanYaml(planFile: PlanFile, title: string): string {
  const lines = [
    `# ${title}`,
    '# Edit freely: move a file line to another group, rename a group key (<module|platform|shared>/<name>), then run `ac steps <this file>`.',
    '# Each file moves with the tests listed on its line. confidence comes from the seeds draft; contested files are judgment calls.',
    'version: 1',
    `packageRoot: ${scalar(planFile.packageRoot || '.')}`,
    `moduleRoot: ${scalar(planFile.moduleRoot)}`,
    `sha: ${scalar(planFile.sha)}`,
    'groups:',
  ];
  for (const [key, entries] of planFile.groups) lines.push(`  ${scalar(key)}:`, ...entries.map(entryLine));
  lines.push('pinned:');
  for (const pin of planFile.pinned) lines.push(`  - { path: ${scalar(pin.path)}, reason: ${pin.reason}, detail: ${JSON.stringify(pin.detail)} }`);
  return `${lines.join('\n')}\n`;
}

const entrySchema = z.object({
  path: z.string().min(1),
  tests: z.array(z.string()).default([]),
  confidence: z.enum(confidences).optional(),
  contested: z.boolean().optional(),
  source: z.enum(sources).optional(),
  rationale: z.string().optional(),
}).strict();

const planFileSchema = z.object({
  version: z.literal(1),
  packageRoot: z.string(),
  moduleRoot: z.string(),
  sha: z.string(),
  groups: z.record(z.string().regex(/^(module|platform|shared)\/[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'group keys are <module|platform|shared>/<kebab-name>'), z.array(entrySchema).nullable()),
  pinned: z.array(z.object({ path: z.string(), reason: z.string(), detail: z.string() })).nullable().default([]),
});

/** Parses and checks an (edited) plan.yaml: well-formed keys and entries, every path in at most one group. */
export function readPlanYaml(text: string): PlanFile {
  const value = planFileSchema.parse(parse(text));
  const groups = new Map<string, PlanFileEntry[]>();
  const owner = new Map<string, string>();
  for (const [key, entries] of Object.entries(value.groups)) {
    for (const entry of entries ?? []) {
      for (const path of [entry.path, ...entry.tests]) {
        if (owner.has(path)) throw new Error(`${path} is listed in both ${owner.get(path)} and ${key}`);
        owner.set(path, key);
      }
    }
    groups.set(key, (entries ?? []) as PlanFileEntry[]);
  }
  const pinned = (value.pinned ?? []) as Pin[];
  for (const pin of pinned) if (owner.has(pin.path)) throw new Error(`${pin.path} is pinned but listed in ${owner.get(pin.path)}`);
  return { packageRoot: value.packageRoot === '.' ? '' : value.packageRoot, moduleRoot: value.moduleRoot, sha: value.sha, groups, pinned };
}

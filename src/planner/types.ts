// Planner vocabulary (plan §3.5): facts → seeds draft → Nemotron edit → validated plan → plan.yaml → steps.
// Paths are package-root-relative posix strings (immich: `src/services/album.service.ts` under `server/`).

/** Role word from the file name or its type folder (`album.service.ts` → service), `registry` for DI/route tables. */
export type Role = string;

export interface FileFact {
  path: string;
  /** 1-based id in path order: how the prompts list the files and their edges. */
  id: number;
  role: Role;
  loc: number;
  /** Exported symbol names, sorted, without `default`. */
  exports: string[];
  /** The exported class, else the first value export, else the first export. */
  primaryExport: string | null;
  /** Table names read and written (Kysely, Prisma, Drizzle call shapes), sorted. */
  tables: { reads: string[]; writes: string[] };
  /** Route prefixes from controller decorators (`@Controller('album')` → album), sorted. */
  routes: string[];
  /** Co-located tests that move with this file (`album.service.spec.ts` next to `album.service.ts`), sorted. */
  tests: string[];
}

export type EdgeKind = 'import' | 'namespace-import' | 'side-effect' | 'reexport' | 'import-equals' | 'require' | 'dynamic-import' | 'mock' | 'typeof-import' | 'member';

/** Directed dependency between two movable files, symbol-level through barrels. */
export interface Edge {
  from: string;
  to: string;
  /** 1 for value use, 0.5 when every site is type-only. */
  weight: number;
  typeOnly: boolean;
  kinds: EdgeKind[];
  symbols: string[];
}

export type PinReason =
  | 'entrypoint' | 'script-reference' | 'migration-or-schema' | 'worker-or-bin' | 'location-sensitive' | 'dynamic-reference'
  | 'barrel' | 'ambient-declaration' | 'generated' | 'test' | 'outside-module-root' | 'profile';

/** A file the plan never moves (plan §2.4). Importers still get specifier rewrites. */
export interface Pin {
  path: string;
  reason: PinReason;
  detail: string;
}

export interface Facts {
  /** Repo-relative package directory, '' for the repo root. */
  packageRoot: string;
  /** Package-relative directory whose files are planned, e.g. `src`. */
  moduleRoot: string;
  /** Commit the facts describe. */
  sha: string;
  /** Movable files, sorted by path; `files[i].id === i + 1`. */
  files: FileFact[];
  /** Edges between movable files, sorted by (from, to). */
  edges: Edge[];
  /** Pinned source files under the module root, sorted by path. */
  pins: Pin[];
}

export type Confidence = 'seed' | 'propagated-strong' | 'propagated-weak' | 'contested' | 'isolated';

/** The deterministic seeds draft: a label per movable file. Labels are bare kebab names or `shared`/`registry`. */
export interface Draft {
  assignment: Map<string, string>;
  confidence: Map<string, Confidence>;
  /** Files whose confidence is contested, propagated-weak or isolated, sorted. */
  contested: string[];
}

export type GroupKind = 'module' | 'shared' | 'platform';

/**
 * How the planner reads Nemotron's answers and ranks the edits, by version (a target profile's `plan.rules` pins one
 * for the replay of its recording: src/planner/edit.ts editSettingsFor).
 * - 1 (S5 to S7): a move names its file by path only, and the ranking starts with validity. The committed immich plan
 *   was made with it.
 * - 2 (S8): a move may also name its file by an id the prompt showed for it (the S7 bench: Ultra named kaneo's and
 *   ghostfolio's moves by id, and the validator dropped every one of them) and its target by a draft group's id or key
 *   (`G8`, `G8:custom-field`: kaneo's moves did), a name two files share names neither, and a plan without feature
 *   modules never ranks first while another candidate has one (ghostfolio's 0-module plan won).
 */
export const plannerRulesVersions = [1, 2] as const;

export type PlannerRules = (typeof plannerRulesVersions)[number];

export const latestPlannerRules: PlannerRules = 2;

/**
 * What a target profile pins for the replay of its recorded plan (the `plan` section of src/certificate/profile.ts's
 * Profile): the critic prompt version and the planner rules the recording was made with.
 */
export interface RecordingPins {
  plan?: { criticPrompt?: number; rules?: number };
}

/**
 * Nemotron's edit of the draft (json_schema strict). Group ids are the draft's G1..Gn. The prompt asks moves to name
 * files by path (as FILES lists them, under the module root): with numeric ids, samples attached rationales to
 * neighbouring files. Planner rules 2 also read the ids the prompt showed (fileNamesOf), since samples use them anyway.
 */
export interface PlanEdit {
  groups: { draft: string; name: string; kind: GroupKind }[];
  moves: { file: string; to: string; kind: GroupKind; rationale: string }[];
}

/** Where a file's final placement came from. */
export type PlacementSource = 'draft' | 'planner' | 'critic' | 'human';

export interface Placement {
  path: string;
  kind: GroupKind;
  name: string;
  confidence: Confidence;
  /** The draft was unsure, or the planner/critic moved it away from its draft group. */
  contested: boolean;
  source: PlacementSource;
  rationale?: string;
}

/** A complete partition of the movable files into groups. */
export interface Plan {
  /** By path, sorted. */
  placements: Placement[];
}

/** `module/album`, `platform/database`. */
export const groupKey = (placement: { kind: GroupKind; name: string }) => `${placement.kind}/${placement.name}`;

export type IssueCode =
  | 'unknown-draft-group' | 'duplicate-draft-group' | 'missing-draft-group' | 'unknown-file' | 'duplicate-move' | 'bad-name' | 'banned-name' | 'foreign-name'
  | 'kind-conflict' | 'pinned-file' | 'missing-file' | 'duplicate-file' | 'registry-outside-platform'
  | 'singleton-group' | 'sub-feature' | 'unknown-group' | 'impure-shared' | 'platform-feature' | 'unsupported-merge' | 'impure-registry'
  | 'one-file-platform' | 'single-consumer-shared' | 'registry-outside-root';

export interface Issue {
  severity: 'error' | 'warning';
  code: IssueCode;
  detail: string;
  file?: string;
  group?: string;
}

export interface PlanMetrics {
  files: number;
  groups: number;
  modules: number;
  sharedOrPlatformFiles: number;
  singletonGroups: string[];
  /** Cross-group edges / all edges between planned files. */
  crossEdgeRatio: number;
  /** Bunch-style TurboMQ: sum of cluster factors (ARCADE port). */
  turboMqSum: number;
  /** ARCADE's normalised TurboMQ: mean cluster factor. */
  turboMqMean: number;
  /** Strongly connected sets of groups (size > 1), each sorted, sorted by first member. */
  cycles: string[][];
  groupsInCycles: number;
  /** Files whose edges pull harder toward another group, strongest first. */
  disagreements: { path: string; group: string; pulledTo: string; share: number; ownShare: number }[];
  /** Files whose group differs from their draft label (after naming). */
  movedFromDraft: number;
}

export interface Validation {
  valid: boolean;
  issues: Issue[];
  metrics: PlanMetrics;
}

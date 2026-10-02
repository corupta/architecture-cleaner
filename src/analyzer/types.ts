// Shared vocabulary of the analyzer and the executor. All paths are repo-relative posix strings.

export type SiteKind =
  | 'import'
  | 'export'
  | 'import-equals'
  | 'dynamic-import'
  | 'typeof-import'
  | 'require'
  | 'require-resolve'
  | 'mock'
  | 'declare-module'
  | 'triple-slash';

/** A module reference with the exact span of its literal content (inside the quotes). */
export interface ReferenceSite {
  kind: SiteKind;
  specifier: string;
  /** Offset of the first character inside the quotes. */
  start: number;
  /** Offset just past the last character inside the quotes. */
  end: number;
  typeOnly: boolean;
  /** For mocks: the callee, e.g. `jest.mock` or `vi.importActual`. */
  callee?: string;
  /** For mocks: `{ virtual: true }` was passed. */
  virtual?: boolean;
}

export type Resolution =
  | { type: 'file'; path: string; via: Resolver }
  | { type: 'external'; path: string; via: Resolver }
  | { type: 'unresolved' };

export type Resolver = 'typescript' | 'jest' | 'vitest' | 'filesystem';

export interface ResolvedSite extends ReferenceSite {
  resolution: Resolution;
}

export type ModuleFormat = 'esm' | 'cjs';

/** Code that makes a file's behaviour depend on where it lives or on what it loads at runtime. */
export interface Hazard {
  kind: 'location-sensitive' | 'dynamic-reference';
  detail: string;
  offset: number;
}

export interface AnalyzedFile {
  path: string;
  format: ModuleFormat;
  /** tsconfig whose options resolve this file's specifiers (repo-relative), or null for defaults. */
  config: string | null;
  sites: ResolvedSite[];
  hazards: Hazard[];
}

export interface Analysis {
  files: Map<string, AnalyzedFile>;
}

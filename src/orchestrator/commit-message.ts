// Commit messages of a run in the target: a conventional subject, a body with the step's identity and counts, and
// once the commit certifies PASS, the certificate trailers (contract C1) as the last paragraph.
import path from 'node:path';
import { rewrapSubject } from '../rewrap/rewrap.js';
import { commonDirectory } from './steps.js';
import type { RungId } from './types.js';

export interface MessageInput {
  /** The commit scope: the package root, else the repository's directory name. */
  scope: string;
  packageRoot: string;
  rung: RungId;
  index: number;
  group: string;
  /** Effective moves, repo-relative old → new. */
  moves: ReadonlyMap<string, string>;
  planSha256: string;
  counts: { filesMoved: number; specifierEdits: number; filesEdited: number };
  /** Files of this step left in place (pinned while replanning), repo-relative. */
  pinned: string[];
  replans: number;
  /** R4: the files the commit adds, and what they are. */
  added?: string[];
  /** R4: what the added files are; S3: what was re-wrapped. */
  summary?: string;
}

const packageRelative = (packageRoot: string, file: string) => (packageRoot && file.startsWith(`${packageRoot}/`) ? file.slice(packageRoot.length + 1) : file);

export function subjectLine(input: Pick<MessageInput, 'scope' | 'packageRoot' | 'rung' | 'group' | 'moves'>): string {
  const scope = `(${input.scope})`;
  if (input.rung === 'R4') return `chore${scope}: add boundary rules with a frozen baseline`;
  if (input.rung === 'S3') return rewrapSubject(input.scope);
  if (input.rung === 'R3') return `refactor${scope}: normalize file names in ${packageRelative(input.packageRoot, commonDirectory([...input.moves.keys()])) || '.'}`;
  const name = input.group.slice(input.group.indexOf('/') + 1);
  return `refactor${scope}: move ${name} into ${packageRelative(input.packageRoot, commonDirectory([...input.moves.values()])) || '.'}`;
}

export function stepMessage(input: MessageInput, trailers: string[] = []): string {
  const lines = [
    subjectLine(input),
    '',
    `Step ${input.index} (${input.rung}, ${input.group}) of plan sha256 ${input.planSha256.slice(0, 12)}.`,
    input.added
      ? `Adds ${input.added.map((file) => packageRelative(input.packageRoot, file)).join(', ')}${input.summary ? `: ${input.summary}` : ''}.`
      : input.rung === 'S3' ? `${input.summary}.` : `${input.counts.filesMoved} files moved; ${input.counts.specifierEdits} specifier edits in ${input.counts.filesEdited} files.`,
  ];
  if (input.pinned.length) lines.push(`Pinned (left in place): ${input.pinned.map((file) => packageRelative(input.packageRoot, file)).join(', ')}.`);
  if (input.replans) lines.push(`Replanned ${input.replans} time${input.replans === 1 ? '' : 's'}.`);
  if (trailers.length) lines.push('', ...trailers);
  return `${lines.join('\n')}\n`;
}

export const scopeOf = (repo: string, packageRoot: string) => packageRoot || path.basename(path.resolve(repo));

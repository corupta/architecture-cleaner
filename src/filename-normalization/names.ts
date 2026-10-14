// R3 names (plan §2.3): `userController.ts` → `user.controller.ts`, `view-repository.ts` → `view.repository.ts`,
// `user_service.ts` → `user.service.ts`. Only casing and separators change: the stem keeps its words (kebab-case), the
// role word keeps the repo's own spelling (lowercased: `utils` stays `utils`, `dao` stays `dao`), and a test suffix and
// the extension are kept. A name without a role word from the closed vocabulary is not R3's business; a name whose words
// can't be told apart (`OAuthService`: O-Auth or OAuth?) is left alone and reported.
import { roleWords as plannerRoleWords } from '../planner/facts-roles.js';

/** The planner's role words (src/planner/facts-roles.ts) plus the other common ones. */
export const roleWords = new Set([
  ...plannerRoleWords,
  'helpers', 'provider', 'factory', 'listener', 'consumer', 'producer', 'adapter', 'exception', 'serializer', 'transformer',
  'router', 'route', 'routes', 'task',
]);

const fileName = /^(.*?)((?:\.(?:spec|test|e2e-spec))?)(\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))$/;
// Words of a camelCase/PascalCase run: an acronym (HTTP in HTTPClient), a capitalized or lowercase word, digits kept
// on the word before them (oauth2).
const camelWords = /[A-Z]+(?![a-z])\d*|[A-Z]?[a-z]+\d*|\d+/g;

export type NameResult =
  | { kind: 'normal' }
  | { kind: 'no-role' }
  | { kind: 'rename'; basename: string; name: string; role: string }
  | { kind: 'unparseable'; detail: string };

/** The parts of a source file's basename: the name R3 normalizes, a test suffix, the extension. Null for other files. */
export function splitBasename(basename: string): { name: string; test: string; extension: string } | null {
  if (/\.d\.[cm]?ts$/.test(basename)) return null;
  const match = fileName.exec(basename);
  return match && match[1] ? { name: match[1], test: match[2]!, extension: match[3]! } : null;
}

/** The words of a dot segment: split at '-' and '_', and camelCase parts at their capitals; a reason string when unclear. */
function words(segment: string): string[] | string {
  const result: string[] = [];
  for (const part of segment.split(/[-_]+/)) {
    if (part === '') continue;
    if (!/[A-Z]/.test(part)) {
      result.push(part);
      continue;
    }
    const found = part.match(camelWords) ?? [];
    // A lone capital before a capitalized word (OAuth: O-Auth or OAuth?) or a word of bare digits (2FA) is a guess.
    const guess = found.findIndex((word, index) => /^\d+$/.test(word) || (/^[A-Z]$/.test(word) && /^[A-Z][a-z]/.test(found[index + 1] ?? '')));
    if (guess !== -1) return `'${part}' splits ambiguously at '${found[guess]}'`;
    result.push(...found);
  }
  return result;
}

/** R3's name for a basename: `normal` when it already is `<kebab stem>.<role>`, `no-role` without a role word. */
export function normalizedName(basename: string): NameResult {
  const parts = splitBasename(basename);
  if (!parts) return { kind: 'no-role' };
  const { name, test, extension } = parts;
  if (/[^A-Za-z0-9._-]/.test(name)) return { kind: 'unparseable', detail: `'${name}' has characters outside letters, digits, '.', '-' and '_'` };
  const segments = name.split('.');
  if (segments.some((segment) => segment === '')) return { kind: 'unparseable', detail: `'${name}' has an empty dot segment` };
  const lastWords = words(segments.at(-1)!);
  if (typeof lastWords === 'string') return { kind: 'unparseable', detail: lastWords };
  const role = lastWords.at(-1)!.toLowerCase();
  if (!roleWords.has(role)) return { kind: 'no-role' };
  const stemSegments = [...segments.slice(0, -1).map((segment) => words(segment)), lastWords.slice(0, -1)];
  const unclear = stemSegments.find((segment): segment is string => typeof segment === 'string');
  if (unclear) return { kind: 'unparseable', detail: unclear };
  const stem = (stemSegments as string[][]).filter((segment) => segment.length).map((segment) => segment.map((word) => word.toLowerCase()).join('-'));
  if (stem.length === 0) return { kind: 'no-role' };
  const normalized = [...stem, role].join('.');
  return normalized === name ? { kind: 'normal' } : { kind: 'rename', basename: normalized + test + extension, name: normalized, role };
}

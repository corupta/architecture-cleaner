// The repo's own words: the vocabulary a group name must come from (plan §3.5), and the singular() that the seeds
// labels and the validator share, so a label and the vocabulary it is checked against always agree.
import type { Facts } from './types.js';

/**
 * The G1 spike's singular(): `categories` → category, `albums` → album; `access` and words of ≤3 letters stay. A guess
 * (`redis` → redi, `status` → statu), so it only matches tokens against fixed English word lists, never the repo's.
 */
export const naiveSingular = (token: string) =>
  token.length > 3 && token.endsWith('ies') ? `${token.slice(0, -3)}y` : token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;

/**
 * A singular() that trusts a singular only where the repo spells it: `albums` → album when `album` is a word,
 * `cookies` → cookie, while `redis` and `status` stay as spelled (the naive rule labelled groups `redi-cache`).
 */
export function attestedSingular(isWord: (word: string) => boolean): (token: string) => string {
  return (token) => {
    if (token.length <= 3 || !token.endsWith('s') || token.endsWith('ss')) return token;
    const candidates = token.endsWith('ies') ? [`${token.slice(0, -3)}y`, token.slice(0, -1)] : [token.slice(0, -1)];
    return candidates.find(isWord) ?? token;
  };
}

/** Lowercased words of a name as spelled: camel/Pascal case, kebab, snake, dots and slashes all split. */
export const wordsOf = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase()
  .split(/[^a-z0-9]+/).filter(Boolean);

const pathWords = (filePath: string) => wordsOf(filePath.replace(/(\.d)?\.[mc]?[jt]sx?$/, ''));

/** Every word the repo spells: path segments and stems (movable and pinned files), exported symbols, tables, routes. */
export function repoWords(facts: Facts): Set<string> {
  const words = new Set<string>();
  const add = (found: string[]) => found.forEach((word) => words.add(word));
  for (const file of facts.files) {
    add(pathWords(file.path));
    for (const symbol of file.exports) add(wordsOf(symbol));
    for (const table of [...file.tables.reads, ...file.tables.writes]) add(wordsOf(table));
    for (const route of file.routes) add(wordsOf(route));
  }
  for (const pin of facts.pins) add(pathWords(pin.path));
  return words;
}

// The complete set of file moves for one step: the requested pathMap plus co-move bundles
// (plan §3.3 step 4: Jest manual mocks sit in `__mocks__/` next to their module; snapshots next to their test).
import path from 'node:path';

// A declaration file and its implementation are one module to TS and to Node: TS resolves the .d.ts, Node loads
// the .js. Moving one without the other would type-check while breaking runtime, so they always move together.
const declarationPairs: [RegExp, string][] = [[/\.d\.ts$/, '.js'], [/\.d\.ts$/, '.jsx'], [/\.d\.mts$/, '.mjs'], [/\.d\.cts$/, '.cjs'],
  [/\.js$/, '.d.ts'], [/\.jsx$/, '.d.ts'], [/\.mjs$/, '.d.mts'], [/\.cjs$/, '.d.cts']];

function pairedFiles(file: string): { suffix: string; strip: RegExp }[] {
  return declarationPairs.filter(([pattern]) => pattern.test(file)).map(([pattern, suffix]) => ({ suffix, strip: pattern }));
}

export function withCoMoves(requested: ReadonlyMap<string, string>, tracked: ReadonlySet<string>): Map<string, string> {
  const moves = new Map(requested);
  for (const [from, to] of requested) {
    for (const { suffix, strip } of pairedFiles(from)) {
      const partner = from.replace(strip, suffix);
      if (tracked.has(partner) && !moves.has(partner)) moves.set(partner, to.replace(strip, suffix));
    }
  }
  for (const [from, to] of [...moves]) {
    const fromDirectory = path.posix.dirname(from);
    const toDirectory = path.posix.dirname(to);
    const mock = path.posix.join(fromDirectory, '__mocks__', path.posix.basename(from));
    if (tracked.has(mock) && !moves.has(mock)) moves.set(mock, path.posix.join(toDirectory, '__mocks__', path.posix.basename(to)));
    const snapshot = path.posix.join(fromDirectory, '__snapshots__', `${path.posix.basename(from)}.snap`);
    if (tracked.has(snapshot) && !moves.has(snapshot)) moves.set(snapshot, path.posix.join(toDirectory, '__snapshots__', `${path.posix.basename(to)}.snap`));
  }
  return moves;
}

export const mapPath = (moves: ReadonlyMap<string, string>, file: string) => moves.get(file) ?? file;

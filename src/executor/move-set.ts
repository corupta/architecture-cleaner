// The complete set of file moves for one step: the requested pathMap plus co-move bundles
// (plan §3.3 step 4: Jest manual mocks sit in `__mocks__/` next to their module; snapshots next to their test).
import path from 'node:path';

export function withCoMoves(requested: ReadonlyMap<string, string>, tracked: ReadonlySet<string>): Map<string, string> {
  const moves = new Map(requested);
  for (const [from, to] of requested) {
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

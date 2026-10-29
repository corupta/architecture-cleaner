#!/usr/bin/env python3
"""Derive immich-2024.rsf: the immich server/ files whose history puts them, or the file they descend from, in a
src/domain/<feature>/ folder before the March 2024 restructure, followed to the bench's pinned commit.

usage: python3 bench/ground-truth/derive-immich-2024.py <immich clone> [--out <dir>] [--at <commit>]

The clone must hold every blob under server/ from 40262c30 to 02063972e8 (a full clone does; a blob:none clone
fetches the missing ones lazily, into its own object store). Only read-only git commands run on it. --at stops the
walk at an earlier first-parent commit and prints the labels there (6e93ddf2 reproduces G2's mapping), writing
nothing. README.md in this folder states the rule, the numbers and the limits.

The rule, one first-parent commit at a time from BASE:
  1. seed: every file under server/src/domain/<feature>/ at BASE takes <feature> (domain/repositories/ is a type
     folder and the domain/ root files belong to no feature: neither is seeded);
  2. a rename git detects at its default threshold (diff-tree -M50%) carries the label; a deletion drops it;
  3. a file the commit adds, copies, renames into or modifies, and that carries no label, takes feature F when at
     least 75% of its non-trivial lines are verbatim lines that a file labeled F had at the parent commit (G2's
     content-merge share, over all the file's non-trivial lines; the files holding a line split into one group per
     feature plus one for all unlabeled files, and the line votes 1/n to each group; a line found nowhere votes for
     none).
Lines are normalized as G2's line_provenance.py did: stripped; lines under 16 characters, imports, lines that start
with a closing bracket or a brace, `export {` and `export * from`, the decorators @Is*, @Optional, @Validate* and
@ApiProperty, and comments don't count. The key keeps the labeled files under server/src at
PIN that are not tests, with paths relative to server/ as the bench's facts name them.
"""
import collections
import os
import re
import subprocess
import sys

BASE = "40262c30cb7d43e059a3dbe0a146a5dd988ab0e6"  # 2024-03-18, refactor(server): library service (#8050)
PIN = "02063972e82b1bfd17b6fc2e3b3ff39936229ea5"  # the bench's immich commit (bench/manifest.json)
PACKAGE = "server/"
SOURCE = "server/src/"
DOMAIN = "server/src/domain/"
CONTENT_SHARE = 0.75
TEST = re.compile(  # src/planner/facts-roles.ts testPattern: the bench's facts never count these as movable
    r"(\.|/)(spec|test|e2e-spec)\.(ts|tsx|mts|cts)$|(^|/)(__tests__|__mocks__|test|tests|e2e)/")
TRIVIAL = re.compile(r"^(import\b|export \* from|export \{|\}|\{|\)|\]|//|/\*|\*|@Is|@Optional|@Validate|@ApiProperty"
                     r"|@ValidateUUID|@ValidateBoolean|@ValidateDate|@IsOptional)")
NEAR_MISS = 0.5  # content shares from here up to CONTENT_SHARE are reported as candidates the rule turned down


def normalize(line):
    stripped = line.strip()
    if len(stripped) < 16 or TRIVIAL.match(stripped) or stripped.startswith("from '"):
        return None
    return stripped


def is_source_file(path):
    return path.startswith(SOURCE) and path.endswith((".ts", ".tsx")) and "/migrations/" not in path


class Repo:
    def __init__(self, root):
        self.root = root
        self.batch = subprocess.Popen(["git", "-C", root, "cat-file", "--batch"], stdin=subprocess.PIPE,
                                      stdout=subprocess.PIPE)
        self.cache = {}

    def git(self, *args):
        return subprocess.run(["git", "-C", self.root, *args], check=True, capture_output=True, text=True).stdout

    def lines(self, blob):
        if blob not in self.cache:
            self.batch.stdin.write(f"{blob}\n".encode())
            self.batch.stdin.flush()
            header = self.batch.stdout.readline().split()
            if header[1] == b"missing":
                sys.exit(f"blob {blob} is missing from the clone")
            data = self.batch.stdout.read(int(header[2]))
            self.batch.stdout.read(1)
            normalized = (normalize(line) for line in data.decode("utf-8", "replace").split("\n"))
            self.cache[blob] = [line for line in normalized if line]
        return self.cache[blob]

    def tree(self, commit):
        files = {}
        for entry in self.git("ls-tree", "-r", commit, "--", SOURCE).splitlines():
            meta, path = entry.split("\t", 1)
            if meta.split()[1] == "blob" and is_source_file(path):
                files[path] = meta.split()[2]
        return files


def seed_feature(path):
    rest = path[len(DOMAIN):] if path.startswith(DOMAIN) else None
    if rest is None or "/" not in rest:
        return None
    folder = rest.split("/", 1)[0]
    return None if folder == "repositories" else folder


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("--"):
        sys.exit(__doc__)
    repo = Repo(os.path.expanduser(args[0]))
    out = args[args.index("--out") + 1] if "--out" in args else os.path.dirname(os.path.abspath(__file__))
    stop = repo.git("rev-parse", args[args.index("--at") + 1]).strip() if "--at" in args else PIN

    files = repo.tree(BASE)
    index = collections.defaultdict(collections.Counter)  # normalized line -> {path: occurrences} at the parent

    def add(path, blob):
        for line in repo.lines(blob):
            index[line][path] += 1

    def remove(path, blob):
        for line in repo.lines(blob):
            index[line][path] -= 1
            if not index[line][path]:
                del index[line][path]

    for path, blob in files.items():
        add(path, blob)
    labels = {path: seed_feature(path) for path in files if seed_feature(path)}
    origin = {path: path for path in labels}
    evidence = collections.defaultdict(list)
    near_misses, deaths = [], []

    def shares(blob):
        """The blob's non-trivial line count, its share per feature by the parent's labeled files, and the labeled
        file that gave it the most lines (a feature's vote is split evenly among that feature's files with the line)."""
        lines = repo.lines(blob)
        votes, file_votes = collections.Counter(), collections.Counter()
        for line in lines:
            paths = index.get(line, {})
            features = {labels.get(path) for path in paths}
            for feature in features:
                votes[feature] += 1 / len(features)
                holders = [path for path in paths if labels.get(path) == feature]
                for path in holders if feature else ():
                    file_votes[path] += 1 / len(features) / len(holders)
        by_feature = {feature: votes[feature] / len(lines) for feature in votes if feature} if lines else {}
        top_file = min(file_votes, key=lambda path: (-file_votes[path], path)) if file_votes else None
        return len(lines), by_feature, top_file

    commits = repo.git("rev-list", "--reverse", "--first-parent", f"{BASE}..{stop}", "--", PACKAGE).split()
    for commit in commits:
        short = commit[:10]
        raw = repo.git("diff-tree", "--no-commit-id", "-r", "-M50%", "-C50%", "-l0", "--raw", "--no-abbrev",
                       f"{commit}^", commit, "--", PACKAGE)
        changes = []
        for entry in raw.splitlines():
            meta, *paths = entry.split("\t")
            _, _, source_blob, target_blob, status = meta[1:].split()
            changes.append((status, paths, source_blob, target_blob))
        changes_status = {paths[-1]: status for status, paths, _, _ in changes}
        # Renames carry labels (a swap a -> b, b -> a included); every renamed or deleted path drops its own, so a
        # path re-created in the same commit is judged as the new file it is.
        carried = {paths[1]: paths[0] for status, paths, _, _ in changes if status[0] == "R" and paths[0] in labels}
        history = {target: (evidence[source] + [f"{changes_status[target]} {short}"], origin[source])
                   for target, source in carried.items()}
        for target, (steps, base_path) in history.items():
            evidence[target], origin[target] = steps, base_path
        gone = {paths[0] for status, paths, _, _ in changes if status[0] in "RD"}
        next_labels = {path: feature for path, feature in labels.items() if path not in gone}
        next_labels.update({target: labels[source] for target, source in carried.items()})
        targets = {paths[-1]: (None if status[0] == "A" else source_blob, target_blob)
                   for status, paths, source_blob, target_blob in changes if status[0] in "ACMRT"}
        for status, paths, _, _ in changes:
            path = paths[0]
            if status[0] != "D" or path not in labels or path not in files:
                continue
            # Where a deleted labeled file's lines went: the commit's files that gained them.
            gone_lines = collections.Counter(repo.lines(files[path]))
            gained = []
            for target, (before_blob, blob) in targets.items():
                if not is_source_file(target):
                    continue
                added = collections.Counter(repo.lines(blob)) - collections.Counter(repo.lines(before_blob) if before_blob else [])
                moved = sum(min(count, added[line]) for line, count in gone_lines.items())
                if moved:
                    total, by_feature, _ = shares(blob)
                    gained.append((moved, target, total, by_feature))
            gained.sort(key=lambda item: (-item[0], item[1]))
            deaths.append((short, path, labels[path], origin[path], sum(gone_lines.values()), gained[:3]))
        for target, (_, blob) in sorted(targets.items()):
            if not is_source_file(target) or target in next_labels:
                continue
            total, by_feature, top_file = shares(blob)
            if not by_feature:
                continue
            feature, share = max(by_feature.items(), key=lambda item: (item[1], item[0]))
            if share >= CONTENT_SHARE:
                next_labels[target] = feature
                origin[target] = None
                evidence[target] = [f"content {short}: {share:.3f} of its {total} lines are {feature}'s, most from {top_file}"]
            elif share >= NEAR_MISS:
                near_misses.append((short, target, feature, share, total))
        for status, paths, source_blob, target_blob in changes:
            if status[0] in "MDRT" and is_source_file(paths[0]):
                remove(paths[0], files.pop(paths[0]))
            if status[0] in "ACMRT" and is_source_file(paths[-1]):
                files[paths[-1]] = target_blob
                add(paths[-1], target_blob)
        labels = next_labels
    assert files == repo.tree(stop), "the walk's tree differs from the commit's"

    labeled = {path: feature for path, feature in labels.items() if path.startswith(SOURCE)}
    key = sorted((path, feature) for path, feature in labeled.items() if not TEST.search(path))
    tests = sorted((path, feature) for path, feature in labeled.items() if TEST.search(path))
    print(f"at {stop[:10]}: {len(key)} labeled files in {len({f for _, f in key})} features, {len(tests)} labeled tests")
    for path, feature in key + tests:
        how = "; ".join(evidence[path]) or "same path"
        print(f"  {feature}\t{path}\t{origin[path] or '-'}\t{how}")
    print("labeled files deleted without a rename (commit, path, feature, path at BASE, lines, top receivers):")
    for short, path, feature, base_path, lines, gained in deaths:
        print(f"  {short} {path} [{feature}] from {base_path}, {lines} lines")
        for moved, target, total, by_feature in gained:
            top = ", ".join(f"{f} {v:.3f}" for f, v in sorted(by_feature.items(), key=lambda item: -item[1])[:2])
            print(f"      {moved} lines ({moved / lines:.0%}) -> {target} ({total} lines; {top or 'no labeled lines'})")
    print(f"content shares from {NEAR_MISS} to below {CONTENT_SHARE} (commit, file, feature, share, lines):")
    for short, target, feature, share, total in near_misses:
        print(f"  {short} {target} {feature} {share:.3f} {total}")
    if stop != PIN:
        return
    with open(os.path.join(out, "immich-2024.rsf"), "w") as handle:
        handle.writelines(f"contain {feature} {path[len(PACKAGE):]}\n" for path, feature in sorted(key, key=lambda item: (item[1], item[0])))
    with open(os.path.join(out, "immich-2024.lineage.tsv"), "w") as handle:
        handle.write("path\tfeature\tpath_at_40262c30\tevidence\n")  # paths relative to server/, as in the key
        for path, feature in key:
            base_path = origin[path][len(PACKAGE):] if origin[path] else "-"
            steps = "; ".join(evidence[path]).replace(f" {SOURCE}", f" {SOURCE[len(PACKAGE):]}") or "same path"
            handle.write(f"{path[len(PACKAGE):]}\t{feature}\t{base_path}\t{steps}\n")


if __name__ == "__main__":
    main()

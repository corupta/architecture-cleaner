# Next session: S4 (certifier, mutation harness, A/B)

Opening prompt for S4, from [sessions/s3.md](sessions/s3.md). Paste it as the first message.

```
Session S4 for architecture-cleaner: the certifier (K0–K4, K6, K8), the mutation harness, and `ac certify` on our branches and the G3 branches.

Read CLAUDE.md, docs/gates.md (G3 and its addendum), docs/sessions/s3.md, docs/plan.md §3.4 (the K table, Independence, Trusting the checker), docs/research/04b-certificate-redteam.md (the K0–K8 redesign and the mutation catalog) and test/fixtures/README.md (the executor contract). Mode: execution, high autonomy, branch s4/certifier from main; merge when the exit criteria hold. No LLM calls.

Build `ac certify <repo> <base>..<head>` as its own feature folder (src/certificate/):
1. It reads only the two committed trees (git ls-tree / git show), never the working tree, and never imports src/executor. It infers the pathMap itself by matching content hashes with specifier spans blanked, so it certifies ANY diff (ours, other agents', humans'). Reusing src/analyzer is allowed, but the independence argument must come from K3(b)/(c): the runner's own resolver and the runtime mechanism.
2. K0 envelope (the plan §2.5 subset the analyzer can see), K1 move-set integrity (total/injective map, no case-only renames, ls-tree modes equal, co-move bundles incl. .d.ts/.js pairs complete, ignore status unchanged), K2 byte-span confinement (new bytes == old bytes outside recognized specifier spans), K3 multi-resolver identity over all tracked files (TS under every program that includes the file, the test runner's own resolver via the target's installed jest/vitest, the runtime alias mechanism; form class preserved), K4 location scan (path-exposing APIs in moved files or their targets; old-path strings anywhere, which also covers non-moved files that load moved files by computed path, i.e. hunt SEM-5; doc hits become findings), K6 test inventory (jest --listTests / vitest list equal modulo pathMap, per-file load status AND case counts, snapshot.added == 0, mocks resolve the same), K8 oracles on the commit in a fresh worktree with hooks bypassed (target tsc, unit suite, per-target extras such as the immich OpenAPI byte-diff from a scratch cwd). Oracle recipes: ~/ac-work/g2/<repo>/commands.sh; toolchain env: scripts/target-env.sh (+ dist/oracles/block-net.cjs for offline).
3. Output: a per-check certificate (JSON + a readable summary) suitable for a commit trailer.

Mutation harness: ≥20 operators from research 04b plus the S3 hunt repros (~/ac-work/s3/bug-hunt.json, bug-hunt-round2.json), applied to known-good results (the applied fixtures' after/ trees as commits, plus ac/s3-bring-up, ac/s3-album and ac/s3-r1). Requirement: 100% killed by K0–K7 without K8; any mutant only K8 catches is a logged soundness hole.

Run and record:
- PASS expected: every applied fixture; openhab ac/s3-bring-up (~/ac-targets/openhab-cloud); immich ac/s3-album and ac/s3-r1 (~/ac-targets/immich, package root server/).
- FAIL expected, with the failing checks named: the four G3 branches, g3/opencode-super and g3/opencode-super-persistent in ~/ac-targets/g3/{immich,mcphub} (base = their root commit). These are the first A/B numbers for the video.
- Also draft docs/storyboard.md (one page, plan §9) for corupta's 15-minute review on Oct 9. Lead with the immich R1 numbers (292 files, 1,445 edits, 2,337/2,337, OpenAPI byte-identical) and the G3 contrast.

Exit criteria: the passes and fails above; mutation kill rate reported (target 100% by K0–K7); docs/sessions/s4.md (10 lines) ending with the S5 opening prompt (LLM gateway port from spike/gates, seeds, the draft-editor planner with Ultra, validator, plan.yaml; include corupta's immich-plan notes from docs/gates.md).
Log weird-but-not-blocking observations with /log-anomaly.
```

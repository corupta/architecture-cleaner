# Shot list

Every shot is scripted, so the cut can be re-rendered from the repository: CLI shots are VHS tapes
([tapes/](tapes/)), site and card shots are Playwright captures rendered frame by frame
([capture/site-shots.mjs](capture/site-shots.mjs)). Output is 1920×1080 at 30 fps, under `video/out/` (not committed).
"In the cut" is the time the shot gets in [script.md](script.md); "raw" is the capture's own length, and a CLI wait
is sped up or cut in the edit, never re-typed.

| # | Shot | Beat | Kind | What it shows | Raw | In the cut |
|---|---|---|---|---|---|---|
| 1 | `hook` | Hook | tape `hook.tape` | immich's own `git log` of server/src, Mar 20–22 2024: the layout PRs (the tape goes on to the two trees; the cut ends on the PR list) | 15 s | 0:00–0:15 |
| 2 | `g3-vitest` | Failure | tape `g3-vitest.tape` | immich's unit suite on opencode's single-shot branch: Test Files 66 failed, 105 passed (171); Tests 2,336 passed, 1 expected fail (2,337), as at base | ~1 min | 0:15–0:24, sped up |
| 3 | `g3-certify` | Failure | tape `g3-certify.tape` | `ac certify --oracles` on that branch, today's tool: K1, K3a, K4, K6, K8 FAIL, verdict FAIL (the same checks as S4's certificate in runs/g3/) | ~8 min | 0:24–0:33, sped up |
| 4 | `site-ab` | Failure | site `ab/index.html` | the A/B table: "a green test count is not proof", the tsc and unit-suite rows, the verdict row | 17 s | 0:33–0:40 |
| 5 | `site-plan` | Ours | site `runs/immich-ladder/` #plan | the critic's review, then a placement the critic decided with its rationale | 9 s | 0:40–0:50 |
| 6 | `ours-certify` | Ours | tape `ours-certify.tape` | `ac certify` on step 1 with its step certificate's checks (`--only K0,…,K7`; `ac run` leaves K8 to the rungs): K0–K7 PASS, digest `909262855d4a…`, the one in the commit's trailer | ~2.5 min | 0:50–1:00, sped up |
| 7 | `trailer` | Ours | tape `trailer.tape` | step 1's commit message: `Ac-Certificate: pass (static) …` and the digest | 6 s | 1:00–1:05 |
| 8 | `site-ladder` | Ours | site `runs/immich-ladder/` #ladder | rungs R0–R4 (each PASS with the oracles), the wall time, the 63 steps scrolling by | 14 s | 1:05–1:14 |
| 9 | `site-fault` | Ours | site `runs/immich-fault/` | step 2's failed attempt: FAIL K3a, K3b, K3c on `workflow-execution.service.ts`; `album.dto.ts` pinned; attempt 2 passed | 9 s | 1:14–1:30 |
| 10 | `site-graph` | Result | site `runs/immich-ladder/` #graph | the four tiles (cycle 12 of 14 → 41 of 70 highlighted), then the files flow | 13 s | 1:30–1:45 |
| 11 | `site-findings` | Result | site `runs/immich-ladder/` #findings | the `BaseService` finding: 56 members injected into 51 classes, 5.7 read on average | 7 s | 1:45–1:53 |
| 12 | `boundaries` | Result | tape `boundaries.tape` | one forbidden import added at the ladder's head; `ac boundaries --check`: 2 new violations, 161 known, exit 1 | 15 s | 1:53–2:05 |
| 13 | `card-misses` | Credibility | card `cards/misses.html` | our own misses, each with what caught it | 6 s | 2:05–2:13 |
| 14 | `card-mutation` | Credibility | card `cards/mutation.html` | 831 mutants, 831 rejected by the static checks | 5 s | 2:13–2:19 |
| 15 | `site-bench` | Credibility | site `bench/index.html` | the bench table: 3 of 5 above the best deterministic method; kaneo's loss and the two rejected plans highlighted | 7 s | 2:19–2:28 |
| 16 | `card-super-vl` | Credibility | card `cards/super-vl.html` | Super VL (thinking on) against Ultra, mean of 3 runs, immich highlighted; the limits | 6 s | 2:28–2:42 |
| 17 | `replay` | Close | tape `replay.tape` | `npx ac demo --replay` in a fresh clone: the start, then the summary and exit 0 | ~11 min | 2:42–2:49, sped up |
| 18 | `card-close` | Close | card `cards/close.html` | the pitch line, the command, the repo and site URLs | 8 s | 2:49–2:57 |
| – | `site-landing` | spare | site `index.html` | the landing page's run cards | 4 s | – |
| – | `rewrap` | optional | – | stretch S3, if the cut has 5 s: `ac rewrap`'s commit and its K2 layout-only line (not taped yet) | – | – |

`card-close` needs the repository and site URLs (placeholders `REPO_URL`, `SITE_URL` in `cards/close.html`) once the
repository is public.

## Rendering

```sh
cd video && npm ci                     # Playwright 1.61.1 (its Chromium build is 1228)
# VHS 0.12, ttyd and ffmpeg on PATH (video/.tools/bin on our machine; see README.md)
npx ac site --out /tmp/ac-site         # from the repository root
node capture/site.mjs --site /tmp/ac-site --out out/site
cd tapes && for tape in hook trailer boundaries ours-certify g3-vitest g3-certify replay; do vhs $tape.tape; done
```

The tapes that run immich's tests or certify (`g3-vitest`, `g3-certify`, `ours-certify`, `replay`) need a quiet
machine, like every recorded run: under load immich's vitest has reported short runs (docs/sessions/s6.md).

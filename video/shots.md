# Shot list

Every shot is scripted, so the cut can be re-rendered from the repository: CLI shots are VHS tapes
([tapes/](tapes/)), site and card shots are Playwright captures rendered frame by frame
([capture/site-shots.mjs](capture/site-shots.mjs)). Output is 1920×1080, under `video/out/` (not committed): the site and card shots at 30 fps, the VHS tapes at 25 fps
(VHS writes 25 whatever `Set Framerate` says); the cut renders 30 fps.
"In the cut" is the time the shot gets in [script.md](script.md); "raw" is the capture's own length, and a CLI wait
is sped up or cut in the edit, never re-typed.

| # | Shot | Beat | Kind | What it shows | Raw | In the cut |
|---|---|---|---|---|---|---|
| 1 | `hook` | Hook | tape `hook.tape` | immich's own `git log` of server/src: the 17 PRs #8080–#8204, Mar 20–22, 2024 (the one `fix:` commit between them left out on screen) | 14 s | 0:00–0:14 |
| 2 | `g3-vitest` | Failure | tape `g3-vitest.tape` | immich's unit suite on opencode's single-shot branch: Test Files 66 failed, 105 passed (171); Tests 2,336 passed, 1 expected fail (2,337), as at base | 65 s | 0:14–0:24, ×10 |
| 3 | `g3-certify` | Failure | tape `g3-certify.tape` | `ac certify --oracles` on that branch, today's tool: FAIL K1, K3a, K4, K6, K8, verdict FAIL (the checks S4's certificate in runs/g3/ failed) | 468 s | 0:24–0:33, from 462 s (the verdict prints at about 464 s), marked "≈ 8 min later" |
| 4 | `site-ab-ultra` | Failure | site `ab/index.html`, the Ultra table | opencode + Nemotron 3 Ultra (S9): what the diff is (374 moved, no import rewritten), the cost ($2.55 billed for 11.6M input tokens in 9 min 26 s; its cap counted $11.76 at the full input price), the verdict (FAIL) | 10.7 s | 0:33–0:43 |
| 5 | `site-plan` | Ours | site `runs/immich-ladder/` #plan | the critic's review (labeled the model's words) and the gate's record, then the placements table opened on one the critic decided | 8.6 s | 0:43–0:51 |
| 6 | `ours-certify` | Ours | tape `ours-certify.tape` | `ac certify` on step 1 with its step certificate's checks (`--only K0,…,K7`; `ac run` leaves K8 to the rungs): K0–K4, K6, K7 PASS, digest `909262855d4a…`, the one in the commit's trailer | 154 s | 0:51–1:01, ×23, the digest held 3.5 s |
| 7 | `trailer` | Ours | tape `trailer.tape` | step 1's commit message: `Ac-Certificate: pass (static) …` and the same digest | 6.6 s | 1:01–1:05 |
| 8 | `site-ladder` | Ours | site `runs/immich-ladder/` #ladder | rungs R1–R4 (each PASS with the oracles; R0, the preflight, passed), the wall time, the 63 steps scrolling by | 13 s | 1:05–1:21 |
| 9 | `site-fault` | Ours | site `runs/immich-fault/` | step 2's failed attempt: FAIL K3a, K3b, K3c on `workflow-execution.service.ts`; `album.dto.ts` pinned; attempt 2 passed | 8.5 s | 1:21–1:32 |
| 10 | `site-graph` | Result | site `runs/immich-ladder/` #graph | the files flow (where the 563 files went), then the tiles, the cycle tile (12 of 14 → 41 of 70) highlighted | 12.5 s | 1:32–1:46 |
| 11 | `site-findings` | Result | site `runs/immich-ladder/` #findings | the `BaseService` finding: 56 members injected into 51 classes, 5.7 read on average (a cut straight to it, past the module-cycle card) | 7 s | 1:46–1:54 |
| 12 | `boundaries` | Result | tape `boundaries.tape` | one forbidden import added at the ladder's head; `ac boundaries --check`: 2 new violations, 161 known, exit 1 | 33 s | 1:54–2:06, ×3.4, the result held 3.5 s |
| 13 | `card-misses` | Credibility | card `cards/misses.html` | our own misses, each with what caught it | 6 s | 2:06–2:13 |
| 14 | `card-mutation` | Credibility | card `cards/mutation.html` | 831 mutants, 831 rejected by K0–K4, K6, K7 before any test case runs | 5 s | 2:13–2:21 |
| 15 | `site-bench` | Credibility | site `bench/index.html` | the bench table: 3 of 5 above the best deterministic method; kaneo's loss and the two rejected plans highlighted | 6 s | 2:21–2:31 |
| 16 | `card-super-vl` | Credibility | card `cards/super-vl.html` | Super VL (thinking on) against Ultra, mean of 3 runs, immich highlighted; the limits | 6 s | 2:31–2:45 |
| 17 | `replay`, `replay-end` | Close | tapes `replay.tape`, `replay-end.tape` | `npx ac demo --replay` typed in a fresh clone; then the verdict lines of the summary it wrote (`/tmp/ac-demo/demo.md`) at the shots' usual font: everything compared matches the recorded run, 62 of 62 trees equal the recorded run's, R4's tree equals the recorded one (S10: the replay's own last screen, 32 lines at 18 px with its key line cut mid-word, couldn't be read in 2.5 s) | 655 s, 10.9 s | 2:45–2:47.5, then 2.5 s from 4.9 s of `replay-end` (the lines are up from 5.1 s), marked "≈ 11 min later" |
| 18 | `card-close` | Close | card `cards/close.html` | the pitch line, the command, the repo and site URLs | 8 s | 2:50–2:57 |
| – | `site-landing` | spare | site `index.html` | the landing page's run cards | 4 s | – |
| – | `site-ab` | spare | site `ab/index.html` | the Super table: the tsc, unit-suite and verdict rows (out of the cut since decision 7) | 13 s | – |

"Raw" is the capture's own length (VHS records slower than the clock on long runs: the replay took 11 min 39 s by
its own timer and 633 s of video). A CLI shot played faster than ×1.2 carries a speed badge in the cut; a long wait
the cut leaves out carries a "≈ … later" badge with the clock time left out, rounded.

`card-close` shows the repository and site URLs (github.com/corupta/architecture-cleaner, corupta.github.io/architecture-cleaner);
re-capture it after any change to `cards/close.html`.

## Rendering

```sh
cd video && npm ci                     # Playwright 1.61.1 (its Chromium build is 1228)
# VHS 0.12.1, ttyd 1.7.7 and a static ffmpeg on PATH (we keep them in video/.tools/bin, not committed);
# VHS finds Chromium as `chromium` on PATH (a symlink to Playwright's build 1228 works) and, in this container, starts it only with `VHS_NO_SANDBOX=true`
npx ac site --out /tmp/ac-site         # from the repository root
node capture/site.mjs --site /tmp/ac-site --out out/site
cd tapes && for tape in hook trailer boundaries ours-certify g3-vitest g3-certify replay replay-end; do VHS_NO_SANDBOX=true vhs $tape.tape; done
cd .. && node cut/render.mjs          # the rough cut: out/cut/rough.mp4, captions.srt and timing.md
node cut/render.mjs --final            # the upload: out/cut/final.mp4, final.srt, thumbnail.png (needs every take in vo/)
```

The tapes that run immich's tests or certify (`g3-vitest`, `g3-certify`, `ours-certify`, `replay`) need a quiet
machine, like every recorded run: under load immich's vitest has reported short runs (docs/sessions/s6.md).

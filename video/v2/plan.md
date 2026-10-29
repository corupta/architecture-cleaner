# Demo video v2: the plan (v2.3, agreed with corupta on 2026-10-28)

The research behind it is [docs/research/06-demo-videos.md](../../docs/research/06-demo-videos.md) (§0 is the
one-page version; §7 and §7b are the panels on the S9 cut and the submitted v1). corupta OK'd the plan on 2026-10-28
with the changes recorded under Decisions; production started the same day. The submitted video (v1, S10:
youtu.be/C1lzr74Ozd4) stays in the entry unless v2 is clearly better (Fallback, below).

## Why a v2

corupta's verdict on the S9 cut: technically adequate, but bloated with text and numbers, as if we dumped facts to
look trustworthy. The panels agree and say where:

- **The moment, for every rater of every version:** the generic agent's run where all the tests still pass and the
  build is broken. The video is built around it.
- **The picture came last.** v1's watchers (seven profiles built from the listed judges' roles, research §7b): the
  before/after diagram is the clearest thing in the video and "arrives in the last five seconds". All seven advise
  opening with it.
- **We assumed too much.** Each watcher listed 7–15 terms it never understood (K-codes, rungs, the "deterministic
  map", MoJoFM, tsc, codemod, OpenAPI spec, opencode…). v1's lowest scores are Design (3.0) and Impact (3.29) from
  the watchers, and "genuinely useful" (3.21): nobody was told who it's for or what a feature layout buys a team.
- **Weakest stretches:** the cycle sizes (heard as a regression), the benchmark and Super VL tables, the dense A/B
  table, the certificate's K-coded output shown before the checker is introduced.
- **Nemotron's role looked small** unless one concrete call is on screen.

## The story in one sentence

**A coding agent can make a 400-file restructure look green while breaking it, so ac splits the job: Nemotron makes
the judgment calls, code moves the files, and a separate checker proves every commit, so you can merge it.**

The tagline stays: *Nemotron draws the map. Code moves it. A checker proves nothing else changed.*

What it has to convey (corupta): the tool is genuinely useful and open to improvement, the concept is good, the
execution is strong. **Useful:** B0–B1 (the pain, what it does), B8 (what you get, the checker on any diff).
**Open to improvement:** B8 (the editable plan; a newer Nemotron already draws better maps). **Concept:** B3 → B5 (the
trap, then the split). **Execution:** B6 and B7 (the catch, then 63 certified commits on a real server).

## Who watches, and the glossary rule

The judges are 23 people from NVIDIA, Nebius and Tavily: system software and AI/ML engineers, developer relations,
product and go-to-market. Few write TypeScript backends. The panel's watcher profiles are built from those roles
(research §7b) and each says what it doesn't know.

**The rule:** every term said or shown is one a non-TypeScript engineer knows, or is defined in five words or fewer
the first time:

| Term | Said or shown as |
|---|---|
| ac | "ac, architecture-cleaner" |
| immich | "immich, a self-hosted photo and video app" |
| opencode | "opencode, a popular coding agent" |
| the map | "which feature each file belongs to" |
| the codemod | "plain code" (the word "codemod" isn't used) |
| tsc, vitest, Node | "the compiler, the test runner and Node" |
| OpenAPI spec | "the API spec" |
| feature folders | the B1 picture: a feature's files gathered in one folder |

Not said or shown anywhere: K-codes, rungs or the ladder, oracles, seeds, MoJoFM, TurboMQ, Louvain, scrambles,
mutants, "the hub", god-injection, platform and shared folders.

## Beats (v2.5, after corupta's notes on animatic 1)

About 345 spoken words. At corupta's own v1 pace (400 words in 2:57.6 with his pauses, about 135 a minute) the video runs
**2:39 plus 1 s fades at each end: 2:41**, 14 s under the 2:55 limit. corupta revises the wording before he records,
as he did for v1; the voice-over lines in [script.md](script.md) are the ones the captions and the cut follow.

| # | Time | Said | Shown | The viewer keeps |
|---|---|---|---|---|
| B0 Hook | 0:00–0:07 | "Have you ever got lost in a verbose repo, trying to decide where to start refactoring?" | immich's real `server/src`, sliced by type, scrolling: too many files for the screen | I know that feeling |
| B1 What it is | 0:07–0:20 | "This is ac, architecture-cleaner. It moves a TypeScript backend from type folders into feature folders, one commit at a time, each with a proof that nothing else changed." | the glide: the album files leave their type folders one by one, asset's and user's follow together, the commit lands certified | what ac does, as a picture |
| B2 Why | 0:20–0:32 | "The maintainers of immich, a self-hosted photo and video app, did this by hand: seventeen pull requests in two days. Why not an AI agent?" | immich's 17 pull requests as a GitHub-style list (no logo, no authors), scrolling; the list blurs and **"17 pull requests · in · 2 days · by hand"** fades in over it | real teams do this, by hand |
| B3 The trap | 0:32–0:53 | "We asked opencode, a popular coding agent, running NVIDIA Nemotron 3 Super on Nebius Token Factory. Over 2,000 test cases still passed, but 66 test files never loaded. And the TypeScript compiler found over a thousand errors. A passing test count is not proof." | opencode's test run in real time; its summary with a red box around "66 failed … (2337)" as the voice says it; then the card's left column: **"opencode + Nemotron 3 Super: 2,337 test cases pass · but · 1,680 compiler errors"** | passing tests aren't proof (the moment) |
| B4 The model? | 0:53–1:05 | "With Nemotron 3 Ultra, it used nearly twelve million tokens, and hit the spending limit even before rewriting imports. It's not the model. It's the job." | the card's right column joins: **"opencode + Nemotron 3 Ultra: 11.6M tokens · but · 0 imports rewritten · (spending limit reached)"** | it isn't the model; it's the job |
| B5 The split | 1:05–1:26 | "So ac splits the job. Nemotron draws the map: which feature each file belongs to. Two calls on Nebius Token Factory, twenty cents. Plain code moves the files and updates their imports, one feature per commit. And a separate checker proves every import still reaches the same file." | the loop: Nemotron → plain code → the checker → commit, each block blue while current, black once past, one note under each; ✓ above the arrow to the commit; **"2 calls · $0.20"** appears when said and stays | the three parts; the model only plans, cheaply |
| B6 The catch | 1:26–1:40 | "Just to test it, we broke one import on purpose. The checker named the file and the line. ac rolled the commit back and redid the step without that file. Certified." | the loop again, the checker and the roll-back path red; the seeded run's certificate with a red box around the file and line 14; attempt 1 ✗ → rolled back → `album.dto.ts` stays where it was → attempt 2 ✓, in order | the proof is specific, and it recovers |
| B7 At scale | 1:40–1:52 | "On immich's whole server, unattended: sixty-three commits, each certified, in under two hours. The compiler, every test and the API spec: exactly as before." | 63 commits landing on the run's clock, "0 rollbacks needed" in green; **"Everything works exactly as before the refactor"**: compiler 0 errors, every test passes, API spec identical | it works on a real 563-file server |
| B8 What you get | 1:52–2:11 | "With ac, every commit carries its verdict. You get a branch to review commit by commit, and a plan you can edit. Point the checker at any diff: opencode's fails, ours passes. And it all replays on your machine: no key, no cost." | terminals, one per feature: the album commit's trailer (a red box around its verdict); the branch's 63 commits; `plan.yaml`'s "Edit freely" and the album entry; the two saved verdicts, opencode's FAIL and ours PASS; `npx ac demo --replay` from a fresh clone | useful to me; checks any agent's work |
| B9 Next | 2:11–2:25 | "Preliminary results also show that the newer Nemotron 3.5 Super VL, thinking long, plans even better on tested repos, and is tied with Ultra on immich." | v1's table: Nemotron 3.5 Super VL against Nemotron 3 Ultra, preliminary, immich highlighted | it grows as Nemotron grows |
| B10 Close | 2:25–2:39 | "You can try it now. Rebuild every commit with one command. Nemotron draws the map. Code moves it. A checker proves nothing else changed. The links are below." | the end card, still: v1's before/after diagram (dots included), the tagline, `npx ac demo --replay` (red), the URLs (blue), v1's hackathon and trademark lines, the feedback footnote | try it; the tagline |

**If the takes run long:** the margin is 14 s; past it, B2's question goes first ("Why not an AI agent?"), then B8's
replay line (the close says it again).

**Gone from v1, and where it lives instead** (the site, the README, the Devpost text): the A/B table; the plan page;
the step list; the files flow; the cycle sizes and the base class; the boundary check; the misses card; the mutation
harness; the benchmark table; the K-coded certificate output; the rung names; Nemotron's individual calls (the draft
groups, the contested file, the review: implementation details, corupta, 2026-10-29).

## The panels

Means of each group's raters. A model's scores are noisy and bunch near 4: read the direction and the comments. Raw
inputs and outputs: `~/ac-work/s11/` (not committed).

| What was scored | Raters | Tech. impl. | Design | Impact | Idea | Useful | Open | Concept | Execution |
|---|---|---|---|---|---|---|---|---|---|
| S9 rough cut (research §7) | 8 AI + 2 proxies | 4.15 | 3.8 | 3.65 | 4.15 | 3.7 | 4.3 | 4.25 | 4.35 |
| S9 storyboard | 4 AI + 2 proxies | 4.08 | 3.33 | 3.67 | 4.33 | 3.58 | 4.42 | 4.5 | 4.33 |
| v2.0 storyboard | 4 AI + 2 proxies | 4.0 | 3.67 | 3.67 | 4.17 | 4.08 | 4.0 | 4.67 | 4.08 |
| v2.1 storyboard | 4 AI + 2 proxies | 4.0 | 4.0 | 3.67 | 4.08 | 4.0 | 3.92 | 4.67 | 4.33 |
| **v1, submitted** (§7b) | 5 AI | 4.3 | 3.7 | 3.6 | 4.2 | 3.8 | 4.5 | 4.3 | 4.3 |
| **v1, submitted** (§7b) | 7 watchers | 4.0 | **3.0** | **3.29** | 4.0 | **3.21** | 4.29 | 4.14 | 4.07 |
| v1, submitted | all 12 | 4.12 | 3.29 | 3.42 | 4.08 | 3.46 | 4.38 | 4.21 | 4.17 |
| animatic 1 (v2.3's order, silent, captions burned in) | all 12 | 4.12 | 3.67 | 3.38 | 4.21 | 3.88 | 3.58 | 4.75 | 4.04 |
| animatic 2 (v2.5's order, v1's Super VL table) | all 12 | 4.04 | 3.62 | 3.58 | 4.08 | 3.92 | 3.21 | 4.58 | 4.04 |

- v2.1's storyboard fixed Design and "useful"; its "2 wins, 2 losses" card was every AI judge's weakest moment
  (v2.3 uses the Super VL line, corupta's pick).
- Animatic 2 against v1 (the same 12 raters): Design +0.33, Impact +0.16, "useful" +0.46, "concept" +0.37; the four
  criteria's mean +0.10 (3.73 → 3.83), short of the +0.3 bar; "open to improvement" −1.17. All five AI judges named v1's
  Super VL table the weakest moment (MoJoFM and TurboMQ unexplained, about 25 decimals in 13 s, its immich row a tie),
  and most watchers got lost there. The animatics are silent (captions only); v1 has corupta's voice.
- v1's watchers set the bar v2 has to clear, with the same profiles and setup: the animatic and the final candidate
  are scored by the same 5 AI judges and 7 watchers.

## The number budget

The voice rounds and says "over" ("over 2,000", "over a thousand", "nearly twelve million"); the screen shows the exact
figure (decision 9), so the two never contradict each other.

| Beat | Said | Its comparison |
|---|---|---|
| B2 | 17 pull requests in 2 days | by hand (against B7's unattended run) |
| B3 | over 2,000 test cases pass | the files were copied, not moved: 66 test files never loaded, over 1,000 compiler errors |
| B4 | nearly 12 million tokens (11.6M on the card), not one import rewritten | B5b: 2 calls, 20 cents, the same model; B3: the Super run beside it on one card |
| B7 | 63 commits, each certified, under 2 hours | the compiler, every test and the API spec as before; 0 rollbacks |
| B8 | better maps on 4 of 5 benchmarks (preliminary) | Ultra's plans |

Cards: the opencode runs (Super, then Ultra, one card), Nemotron's footer, B2's, B7's and B8's; each on screen at least
3 s, each spoken as it appears. Before the render, numbers.md gets rows
for every new figure or wording: "over 2,000", "over a thousand", "nearly twelve million", "2 calls", "line 14", the
draft's five asset groups, "0 rollbacks", "4 of 5", the 17 PR titles.

## Look and sound

- **One text layer at a time.** No lower thirds. Labels of 2–5 words sit beside what they name, appear as the voice
  says it, and stay ≥ 3 s. Cards are the only full-screen text.
- **Captions** (corupta): every cut until the final is rendered with the captions burned in, in a band at the bottom
  the picture never uses, for corupta's reviews and the panel. The upload has no burned-in captions; our `.srt` goes to
  YouTube as closed captions.
- **Readable on a phone.** Terminal shots re-recorded at FontSize 36–40 (about 80 columns) and punched in on the line
  that matters; nothing that matters under ~38 px at 1080p; every frame checked scaled to 512 px wide. Lines are
  filtered, never cut mid-word.
- **The animations** (M0, M1): file names in the site's monospace on the light page; no colored dots (corupta: they
  distract in motion); the moving files carry the eye, the folder names stay bold and still.
- **Palette:** the site's (`video/cards/card.css`): light page, ink text, blue for ac, orange for highlights, green for
  pass, red for fail. Terminals as dark windows on the light page.
- **Motion:** cuts and light punch-ins (1.1–1.3×), wide → narrow → wide; no wipes, no flourishes. About 25–30 shots,
  none under 3 s.
- **Voice:** corupta, off camera, conversational ("we", "you"), at the S10 setup, one take per beat.
- **Music:** a starter is in [music/](music/README.md) for corupta to compose on in strudel.cc (his brief: quiet, one
  instrument on a four-note major-pentatonic figure, repeated, a plain "tap tap tap blap" beat, synthesized sounds
  only). Mixed after picture lock, about 25 dB under the voice, out for the pause in B3. No music unless it's clearly
  better with it.

## Assets

**Tapes, the tool's own output (VHS, scripted), re-recorded at FontSize 36:**

| Tape | Beat | What | Quiet machine |
|---|---|---|---|
| `g3-vitest` | B3 | immich's unit suite on opencode's single-shot branch | yes, ~1 min |
| `fault-cert` (new) | B6 | the seeded run's failed certificate (`runs/immich-fault/certificates/failed/`), its three FAIL lines | no |
| `trailer` | B7 | `git log` with the `Ac-Certificate:` trailer | no |
| `branch-log` (new) | B8 | `git log --oneline` of the ladder's branch | no |
| `plan-entry` (new) | B8 | `plan.yaml` at one entry | no |
| `certify-verdicts` (new) | B8 | `ac certify` on opencode's branch and on ours, the verdict lines | yes, ~8 + 2 min |
| `replay` | B9 | `npx ac demo --replay` in a fresh clone | yes, ~11 min |

**Graphics, in code** (HTML and SVG with a frame clock, captured frame by frame by the Playwright pipeline, so they
re-render). Each reads the runs' own files at render time, so no figure can drift from its source, and each looks like
a diagram, never like the tool's output:

| | What | Reads | Beats |
|---|---|---|---|
| M0 | the type-sliced tree, scrolling | `runs/immich-ladder/certificate.json` (the base side of `pathMap`) | B0 |
| M1 | the glide: a feature's files into its folder | the same `pathMap` | B1, B9 |
| H | immich's history: the 17 PR titles | immich's git history (the S9 hook tape's range) | B2 |
| M2 | the loop: map → move → proof → commit, ✗ → roll back | – | B5a, B6 |
| M3 | Nemotron's calls: the asset merge, one contested file and its reason, the review | `runs/immich-ladder/plan/` | B5b |
| M4 | the run: commits landing on a clock; the seeded run's step 2 | both runs' `events.jsonl` | B6, B7 |
| C | the cards | numbers.md rows | B2–B8 |
| E | the end card | `video/diagram/diagram.js`'s data | B9 |

immich's history is drawn by us from its git history, not captured from GitHub's site: a page of github.com carries
GitHub's logo and contributors' avatars, which the rule on third-party marks keeps out (S10's audit). The titles,
numbers and dates are the same.

**The cut:** `video/cut/render.mjs` learns to render a cut from another folder (`--cut v2`: its `script.md`,
`edl.json`, `vo/`, writing to `out/v2/`), with punch-in and crop per shot, labels in the picture and the caption band.
S10's cut stays as it is and renders the same.

## Honesty rules (kept from S9 and S10)

- Every number on screen or in the voice is in [docs/numbers.md](../../docs/numbers.md); new ones get rows first. The
  voice and the screen agree (the number budget).
- No staged terminal output: every terminal frame is the tool's own. Cropping, punching in and filtering lines are
  presentation (corupta, 2026-10-28); retyping or editing output is not.
- Sped-up footage carries a badge (×N); a wait the cut leaves out carries "≈ … later".
- Graphics are built from the runs' files and look like diagrams, not like the tool.
- opencode is named, with its model and provider said aloud (decision 4); the Ultra arm is shown (decision 7).
- The seeded fault is labeled as seeded, and as its own run.
- Nothing claims the new layout lowers coupling (decision 5): no cycle sizes, no "cleaner".
- The end card's trademark line; no logos, no third-party UI beyond a terminal, no third-party music.

## Decisions (corupta, 2026-10-28)

1. **The order:** a short generic hook (B0), then what ac is, an intro the close returns to (B1, B9), then immich,
   defined (B2). immich's history as a page, not a terminal (drawn by us; see Assets).
2. **The scene:** corupta's idea is the diagram of what ac does (files sliced by type, then by feature). v1 has it as
   a still (`video/diagram/diagram.js`: the end card and the thumbnails); v2 animates it as the opening glide, our own
   version, without the colored dots.
3. **B8:** the growth line (Super VL draws better maps, preliminary), not "2 wins, 2 losses".
4. **Captions:** burned in on every review cut; the upload without them, with the `.srt` as closed captions.
5. **Crop, punch-in and line filters** on the tool's own output are fine.
6. **Music:** a starter now for corupta to compose on; mixed only if it's better.
7. **What leaves the video:** as listed under the beats.
8. **Watchers:** the panel's profiles come from the judges' roles, and the glossary rule follows from them (corupta: we
   over-assume what judges know). corupta's v1 wording carries over where it fits: immich defined, "over 2,000"
   rounding (said as "over" so it matches the 2,336 on screen), the spending limit as the reason Ultra's agent
   rewrote nothing, "just to test it".

9. **Motion and text** (corupta, on animatic 0, 2026-10-28): motion only where it means something by its nature (files
   moving to their place; chronology). Static text is on screen from the shot's first frame: no line-by-line reveals,
   no rising text. Chronology has one convention, the loop diagram's: every element is there but faint from the
   start and turns opaque when the voice reaches it, its label with it. Exact numbers on screen (the voice rounds:
   2,337 / 2,337 and 1,680 shown, "over 2,000" and "over a thousand" said). The same names everywhere ("opencode +
   Nemotron 3 Super", "opencode + Nemotron 3 Ultra"). Terminal shots fill a black frame, padded, all at one size;
   a red box marks what matters instead of a crop. Per scene: immich's PRs as a GitHub-style list (no logo, no
   authors) scrolling like the opening tree; the two opencode runs as one card, Super on the left, Ultra on the right;
   Nemotron's calls as one stable scene ending on "2 calls · $0.20"; the end card with v1's diagram, dots included.

10. **The order and the scenes** (corupta, on animatic 1, 2026-10-29): the demo on immich ends with "everything works
    exactly as before the refactor"; then ac's features, one terminal each (every commit carries its verdict; the branch;
    the editable plan; the checker on any diff; the replay); then the one look ahead, Super VL, with v1's table and
    its words (Nemotron grows, the tool grows with it; the Clean Architecture roadmap stays in the README); then v1's
    close. Nemotron's individual calls leave the video (implementation details); "2 calls · $0.20" moves into the loop.
    The faint-then-opaque effect is for chronology only; in a sequence, blue marks the block that is current, black the
    ones done, red and green failure and success. Red boxes mark the lines that matter in terminals; no annotations that
    don't carry meaning, no "≈ later" badge where the tool's own output shows its duration.

Storyboard decisions this changes: decision 1 (the hook led with immich), decision 6 (Super VL is now B8's line, one
sentence with its limits on the card), and the credibility beat (misses, mutation, bench table) leaves the video.

## Production schedule

All times UTC (PT = UTC − 7).

| When | Who | What |
|---|---|---|
| Tue Oct 28, from ~14:30 | Claude | `render.mjs --cut`; M0–M4, H, the cards and the end card; the tapes (the four quiet ones chained, ~25 min, no agents running); `v2/edl.json` → **animatic**: silent, captions burned in, at v2.3's timing |
| Tue Oct 28, evening | Claude, then corupta (15–20 min) | the panel on the animatic (v1's setup: 5 AI judges, 7 watchers); corupta's review → **script lock** |
| Wed Oct 29 | corupta (~1 h) | the v2 takes, one per beat, the S10 setup; the music, if he wants it |
| Wed Oct 29 | Claude | the cut with the takes, `timing.md` against the shots, fixes, the music mix → the **final candidate** |
| Wed Oct 29, evening | Claude, then corupta (15 min) | the panel on the candidate against v1, same setup; corupta's **go / no-go** |
| Thu Oct 30, by 13:00 (06:00 PT) | Claude, corupta | the upload, no burned-in captions, our `.srt`, chapters; unlisted for a last check, then public |
| Thu Oct 30, by 15:00 (08:00 PT) | corupta (5 min) | the new link in the Devpost entry; the README and devpost.md pushed |
| Thu Oct 30, 17:00 (10:00 PT) | – | the deadline: the entry freezes |

## Fallback

v1 stays in the entry unless v2 is clearly better, by the panel and by corupta:

- the panel's means on the four criteria at least 0.3 higher than v1's (the same 5 AI judges and 7 watchers), with
  no criterion lower;
- the watchers recall what ac is, who it's for, and the B3 moment;
- corupta prefers it.

If v2 isn't ready by Oct 30 08:00 PT, v1's link stays; v2 can go on the repo and the site afterwards, not into the
frozen entry.

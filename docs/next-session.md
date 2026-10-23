# Next session: S9 (the recording session: final recorded runs, numbers frozen Oct 22, site deployed, repo public)

Opening prompt for S9, from [sessions/s8.md](sessions/s8.md). Paste it as the first message.

```
Session S9 for architecture-cleaner: the recording session. The feature freeze held on Oct 20 (tag freeze), and main also carries the Super VL experiments S8b to S8d (tags s8b and s8d; the demo's planner is still Ultra); numbers freeze Oct 22, submission Oct 28.

Read CLAUDE.md, docs/sessions/s8.md, docs/storyboard.md, docs/plan.md §8 and §9, and README.md. Mode: execution, high autonomy; no feature work, only fixes for defects found while recording, each with a regression test. No LLM spend is planned; open budget run s9 (cap $1) only if corupta asks for a live recording.

1. Decided by corupta on 2026-10-23: the demo is runs/immich-ladder as recorded (S6, planned by Ultra; the frozen tool reproduces it byte for byte), S3 is shown from runs/immich-rewrap, and Nemotron 3.5 Super VL's bench results are shown as preliminary, with their limits and the reasons for keeping Ultra (bench/experiments/s8b-super-vl/README.md, storyboard decision 6). No re-recording of the ladder.
2. Final recorded runs on a quiet machine, no agents, from a frozen copy of main: the judges' path from a fresh clone (npx ac demo --replay, then --env --oracles), timings and digests into the README; ac site --out built twice, byte-identical.
3. Going public is corupta's call: once corupta makes the GitHub repo public (or says to), fill the README's clone and site URL placeholders, deploy the site with .github/workflows/pages.yml, and check the deployed pages against the local build.
4. Freeze the numbers (Oct 22): check every number in the README, the storyboard and the site against its source once more, and list them with their sources in docs/numbers.md.
5. Video prep (Oct 22–23): the script from the storyboard's beats, a shot list, scripted captures (VHS tapes for the CLI, Playwright for the site), and the plan for a captioned rough cut under corupta's voiceover.

Exit criteria: main tagged freeze-numbers, the site live, the repo public, the script and shot list ready for corupta's 15-minute OK, and docs/sessions/s9.md ending with the next session's prompt.
Log weird-but-not-blocking observations with /log-anomaly.
```

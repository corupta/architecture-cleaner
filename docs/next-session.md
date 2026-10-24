# Next session: S10 (the cut and the submission)

Opening prompt for S10, from [sessions/s9.md](sessions/s9.md). Paste it as the first message.

```
Session S10 for architecture-cleaner: the cut and the submission. Numbers are frozen (tag freeze-numbers, docs/numbers.md); the repo is public (github.com/corupta/architecture-cleaner, MIT) and the site is live (corupta.github.io/architecture-cleaner). Submission is Wed Oct 28; the deadline is Oct 30 10:00 PT; judging runs Dec 1–15, and the project must stay testable, free, until then.

Read CLAUDE.md, docs/sessions/s9.md (with its addendum), video/script.md, video/shots.md, video/rough-cut.md, docs/plan.md §8 to §10 and README.md. Mode: execution, high autonomy; no feature work, only fixes for defects found, each with a regression test. No LLM spend planned (the ledger stands at $35.96 of $50). Push to origin when a step is done (a deploy key is set up); Pages redeploys on push, so check the deployed pages against a local build after each push that touches the site.

The submission rules (Devpost's rules page, read 2026-10-24; Devpost blocks automated fetches, so this is the copy to work from):
- Fields: a text description of the features and functionality; a URL to a working demo, hosted application or test build; the public repo URL; the track (Coding and Agentic Engineering: "coding agents and developer tools: agents that write, run, and test code in Token Factory"); feedback on Nebius Token Factory, AI Cloud and any NVIDIA tools, models or technologies used.
- Repo: public, with all source and instructions needed to run it; an open-source license "detectable and visible at the top of the repository page (in the About section)"; a README with setup instructions that highlights "how you've used NVIDIA Nemotron or other NVIDIA open source models and where Token Factory accelerated your workflow and any other Nebius Tools or Services used".
- Video: under 3 minutes ("judges are not required to watch beyond three minutes"), footage of the project working, public on YouTube, and "must not include third party trademarks, or copyrighted music or other material" without permission.
- Judging (equal weight): Technological Implementation, Design ("a complete, coherent product experience"), Potential Impact ("a credible, specific case for solving a real problem for a real audience"), Quality of the Idea ("a creative, non-obvious use of ... Nemotron"). Most Valuable Feedback (10 × $100 and NVIDIA swag) is judged on "the completeness, viability, and potential impact of the feedback".

1. corupta's script OK (video/script.md): the failure beat's Ultra line (storyboard decision 7) and the hook ending on immich's 17 PRs. Then the voice-over: corupta's takes in video/vo/<beat>.wav (hook, failure, ours, result, credibility, close), read against rough cut v0; render v1 with `node video/cut/render.mjs`; fix each take that overruns its slot in the text, or in cut/edl.json and script.md together; check that each sentence lands on its shot (a review in S9 flagged "for twenty cents" falling after the cut to ours-certify).
2. The final cut: at most 3:00 on the file, −14 LUFS, a 1 s fade at each end, the thumbnail from the close card; every number on screen in docs/numbers.md. Check the trademark rule against what's on screen (opencode, immich, NVIDIA and Nebius names in a factual comparison). corupta uploads it to YouTube (public); its URL goes into the README.
3. The README against the rule above: the Nemotron and Token Factory usage, where Token Factory accelerated the work, the setup. The repo's About section: a description and the site as the website (corupta's step on GitHub, or `gh` with a token).
4. Devpost: draft the text (what it does, how Nemotron on Nebius Token Factory is used and what it cost, how it's built, the misses, what's next: Clean Architecture), Built With, the demo URL (the site) and the test build (npx ac demo --replay) in docs/devpost.md, and the feedback write-up from docs/feedback-log.md, complete and specific enough for the Most Valuable Feedback bonus. corupta reviews both (30 min) and submits.

Exit criteria: the video public on YouTube and linked from the README; the repo's About section filled; docs/devpost.md ready and the entry submitted by corupta; main tagged submitted; docs/sessions/s10.md.
Log weird-but-not-blocking observations with /log-anomaly.
```

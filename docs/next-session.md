# Next session: S10 (the cut and the submission)

Opening prompt for S10, from [sessions/s9.md](sessions/s9.md). Paste it as the first message.

```
Session S10 for architecture-cleaner: the cut and the submission. Numbers are frozen (tag freeze-numbers, docs/numbers.md); submission is Wed Oct 28, the deadline Oct 30 10:00 PT; the project must stay testable, free, until Dec 15.

Read CLAUDE.md, docs/sessions/s9.md, video/script.md, video/shots.md, video/rough-cut.md, docs/plan.md §8 to §10 and README.md. Mode: execution, high autonomy; no feature work, only fixes for defects found, each with a regression test. No LLM spend.

1. Going public, if S9 couldn't: corupta's GitHub repository, pushed and public, Pages from .github/workflows/pages.yml (Settings > Pages > Source: GitHub Actions); the README's clone and site URLs and video/cards/close.html's REPO_URL and SITE_URL filled; the deployed pages checked against a local `npx ac site` build of the same commit (identical apart from the source link).
2. The voice-over: corupta's takes in video/vo/<beat>.wav (hook, failure, ours, result, credibility, close), read against rough cut v0 (video/out/cut/rough.mp4). Render v1 with `node video/cut/render.mjs`; fix each take that overruns its slot in the text or in cut/edl.json and script.md together; captions from the script, timed to the takes.
3. The final cut: at most 3:00 on the file, −14 LUFS, a 1 s fade at each end, the thumbnail from the close card; every number on screen in docs/numbers.md. corupta uploads it to YouTube (public) and the URL goes into the README.
4. Devpost: the text (what it does, how Nemotron on Nebius Token Factory is used and what it cost, how it's built, the misses, what's next: Clean Architecture), Built With, the tool-feedback write-up from docs/feedback-log.md (the Most Valuable Feedback bonus), the demo URL (the site) and the test build (npx ac demo --replay). Draft it in docs/devpost.md for corupta's 30-minute review.
5. README final: setup, the Nemotron usage, the video and site links; a last check of every number against docs/numbers.md.

Exit criteria: the video public on YouTube; the site live and the repo public; docs/devpost.md ready, and the entry submitted by corupta; main tagged submitted; docs/sessions/s10.md.
Log weird-but-not-blocking observations with /log-anomaly.
```

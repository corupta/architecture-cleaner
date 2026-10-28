# Next session: S11 (a better demo video: research and plan)

Opening prompt for S11, from corupta's request in S10 (2026-10-27). Paste it as the first message. S10 closed on
2026-10-28 with the entry submitted (tag `submitted`); a better video can still replace the link until the deadline.

```
Session S11 for architecture-cleaner: a better demo video, research and plan. This is a planning session: research, design and discuss with corupta; write new docs only, and change nothing in video/, src/, runs/ or the README until corupta OKs the plan. Ultracode workflows are fine for the research; no Token Factory spend.

Where things stand: S10 closed on 2026-10-28. The entry is submitted with the safe video (https://youtu.be/C1lzr74Ozd4: the S9 script, corupta's voice-over and rounded numbers, captions as YouTube CC, the before/after diagram from video/diagram/diagram.js on the close card and the thumbnails). The deadline is 2026-10-30 10:00 PT and the entry stays editable until then, so a better video can replace the link if it is ready by Oct 30 08:00 PT.

Read first: CLAUDE.md; docs/sessions/s10.md; docs/storyboard.md (locked with corupta, decisions 1–7); video/script.md, video/shots.md, video/rough-cut.md; docs/devpost.md (what the judges read); docs/plan.md §9–10; the replay site (npx ac site --out /tmp/site); the S9 rough cut (video/out/cut/rough.mp4).

corupta's verdict on the S9 cut: technically adequate, but bloated with text and numbers, as if we dumped facts to look trustworthy. His view: the tool is genuinely useful and open to improvement, the concept is good, the execution is strong, and the video has to convey those three things, not the inventory.

1. Research. corupta studied demos and presentations growing up; sync with him, don't lecture. Write docs/research/06-demo-videos.md:
   - Great product demos and launch videos from the world, developer tools and coding agents above all, plus live keynote demos and YC Demo Day pitches. For each: how fast it reaches the product working, the hook, how it shows proof, how much text and how many numbers are on screen, pacing, voice, music.
   - The craft: story structure (problem, stakes, turn, proof, call to action), show-don't-tell, one idea per scene, showing data (one number at a time, with its comparison), on-screen text economy, pacing for 3 minutes, screen-recording technique (zoom, focus, highlight), audio (voice first; music bed or none), captions.
   - A few past hackathon winners in developer-tool or agent tracks, and what their videos did.
   - For every source: the link, what we take from it, and the timestamp where it shows. Mark what was checked and what is opinion.
2. Who watches. People, and possibly AI models (an Opus-class model given the transcript, sampled frames and the Devpost text). Work out how each takes in a 3-minute video:
   - what an AI judge sees (captions or speech-to-text, frames at some interval, the description) and what it misses (sub-second flashes, on-screen text it never samples);
   - whether dense numbers help or hurt it;
   - how to design for both audiences without gaming either.
   Then measure it. Run an AI-judge panel: agents scoring against the four judging criteria and the Most Valuable Feedback bonus, from the transcript only, the frames only, and both. Add a human-proxy pass: a skeptic with 3 minutes and no context. Run both on the S9 rough cut first, and later on the v2 storyboard and animatic.
3. The plan, video/v2/plan.md, for corupta to discuss and change:
   - the story in one sentence;
   - the beats with timings: for each, what is said, what is shown, and the one thing the viewer keeps;
   - the number budget: the few numbers that carry the story, each shown once with its comparison; the rest live on the site and in the README, linked;
   - the assets. Existing: VHS tapes, site captures, cards, the render pipeline. New: e.g. the plan-move-certify loop as a diagram or motion graphic, generated in code so it re-renders. Any new tool must be scriptable and free;
   - the voice-over script; music (none, or royalty-free under a license the rules allow);
   - what stays from the honesty rules: no staged terminal output, every number in docs/numbers.md, speed badges, the trademark line;
   - a production schedule that ends with the video public by Oct 30 08:00 PT, naming corupta's time (voice-over, reviews);
   - the fallback: the S10 video stays submitted unless v2 is clearly better, by the panel and by corupta.
4. Discuss with corupta (he has ideas too), revise, and get his OK. Production comes next, in this session if time allows.

Exit criteria: docs/research/06-demo-videos.md; video/v2/plan.md agreed with corupta; the panel's scores for the S9 cut and the v2 storyboard; the production schedule.
Log weird-but-not-blocking observations with /log-anomaly.
```

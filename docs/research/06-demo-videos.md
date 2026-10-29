# 06: Demo videos (research for the v2 video, S11)

Researched on 2026-10-27 for [video/v2/plan.md](../../video/v2/plan.md). This is a document to sync on, not a lecture:
what we saw, what we take, and where the evidence is thin. Six researchers covered six areas and a skeptic re-checked
each one (verdicts at the end); the corrections are applied below. An AI-judge panel and two human proxies scored the
S9 rough cut (§7).

**How the videos were checked.** `yt-study`, a scratch helper (not committed), downloads a YouTube video at 360p,
transcribes it on our CPU with faster-whisper (base.en) and samples frames every few seconds. A timestamp marked
[watched] comes from that transcript and those frames, in the linked upload. Transcripts are machine-made, so quotes
are as heard ("Quad" corrected to "Claude"). The marks:

- **[watched]**: checked with the frames and transcript;
- **[page]**: read on the source page;
- **[secondary]**: from someone else's description;
- **[opinion]**: taste, ours or the source's;
- **[inferred]**: measured indirectly, e.g. music from the audio level in speech gaps. The skeptics showed this method
  is unreliable (below), so treat every music claim as a guess.

## 0. In one page [opinion, from everything below]

1. **The product is on screen working within about 15 s.** The six launch videos of developer tools we studied did it
   in 8–45 s (median about 15–20 s); the six hackathon winners within 0:45. S9 showed our checker at 0:24 and our own
   run at 0:43.
2. **Say what it is in the first sentence** (Graham, Ralston, Devpost's help, Sentinel's opening). S9's first sentence
   is about immich.
3. **One memorable moment per video**, given room: slide to unlock, Dropbox's debug line, Duplex's "Mm-hmm",
   LORE's callback. Ours is either the green-but-broken run or the checker catching a bad move; the panel picked the
   first, unanimously (§7).
4. **Few numbers, each with its comparison, each spoken as it appears and held alone.** Four of six launch videos put
   no number on screen on purpose; Graham: "Don't give them more than four or five numbers". S9: about 30 spoken
   numbers, about 55 numerals in the lower thirds alone, and 250–350 numbers on screen by the frame judges' count.
5. **One text layer at a time.** No lower thirds over captions over terminal text. Mayer's coherence and redundancy
   results point the same way; none of the six hackathon winners used lower thirds.
6. **Proof is a raw artifact, cropped to the line that matters**: Dropbox's log line, Sentinel's one JSON object per
   step, Saphira's trace to the source page. Big enough to read at 512 px wide.
7. **Show a failure the system recovers from**: Devin's KeyError, Cursor rejecting a bad result, GPT-4o's slip,
   Duplex's call that "goes a bit differently". Plus one plainly spoken limit (Echo Canvas, Sentinel, the Claude Code
   explainer).
8. **Name the parts before the run** (Mayer's pre-training): one diagram of plan, move, certify; then no K-codes or
   rung names on screen.
9. **The voice carries the whole argument.** A transcript alone must make the case; an AI judge may get only that,
   and a person skimming gets mostly that. Upload our own .srt as the caption track.
10. **The builder's voice, conversational.** Every winner used its builders' voices; the face is optional (Fiorella
    and Mayer: an on-screen speaker doesn't necessarily help). corupta stays off camera.

## 1. Launch videos of developer tools and coding agents

Six studied [watched]; dates and views are YouTube metadata as of 2026-10-27 [page].

| Video | Length | Product working at | Voice | Narration | Numbers on screen on purpose |
|---|---|---|---|---|---|
| [Introducing Devin](https://www.youtube.com/watch?v=fjHtjT7GO1c) (Cognition, 2024-03) | 1:50 | 0:15 | CEO on camera, then voice-over | 157 wpm | a 6-bar SWE-bench chart (about 1:28–1:35) and 3 results in a zoomed terminal (about 1:08–1:12), about 11 s in all |
| [Introducing the GitHub Copilot coding agent](https://www.youtube.com/watch?v=EPyyyB23NUU) (2025-05) | 0:50 | about 0:18 (its PR; 0:06 is VS Code's agent mode) | none: music is the soundtrack | – | 0 |
| [Introducing Claude Code](https://www.youtube.com/watch?v=AJpK3YTTKZ4) (Anthropic, 2025-02) | 3:54 | 0:45 | engineer and PM on camera, then voice-over | 139 wpm | 0 |
| [Cursor now shows you demos, not diffs](https://www.youtube.com/watch?v=XbZvC4KTH68) (2026-02) | 1:42 | 0:08 | two builders talking | 210 wpm | 0 |
| [Meet the New Codex CLI](https://www.youtube.com/watch?v=PUBc2G0Tj5E) (OpenAI, 2026-10) | 3:14 | 0:40 (a terminal from 0:25) | presenter, picture-in-picture over the terminal | 171 wpm | 0 |
| [Introducing Warp 2.0](https://www.youtube.com/watch?v=k9BRhSbVSpI) (2025-06) | 2:27 | 0:15 | founder, UI insets beside him | 140 wpm | 2 cards (1:18–1:22), read aloud |

What they do [watched unless marked]:

- **Spotlight, not callouts.** Devin dims the UI and enlarges the one panel that matters: the plan (0:25), the
  traceback (0:57), the diff (1:00), the results (1:10), the deployed URL (1:20). Scene detection finds no hard cuts in
  Devin or Copilot: they move by zooms, fades and kinetic text. Devin still has a name super (0:05) and a disclaimer,
  "Devin is in private beta and may make mistakes" (0:15).
- **Skip the wait, keep the work.** Cursor shows its agent operating the app in the agent's own recording (0:28–0:40)
  but skips the live wait ("Later, it came back with a video", 0:24). Copilot's PR checklist fills in across
  transitions (0:30–0:36).
- **Disclose the speed-up once.** Claude Code's only overlay in 3:54: "Responses accelerated for demo viewing purposes"
  (1:03).
- **A big terminal.** Claude Code and Codex scale the terminal to fill the frame on a brand-colour backdrop; 50–120
  words per frame stay readable even at 360p.
- **Cut rate** (ffmpeg scene detection): Cursor every 3–4 s; Claude Code and Codex about every 7 s; Warp about 12 s.
- **Proof:**
  - Devin shows the deployed result first (1:15–1:25), then one chart. The narration doesn't read its numbers
    ("It's a really hard problem and we've only just started"). The caveat, an unassisted 25% subset against assisted
    models, is a footnote unreadable at 360p; it's on the [blog](https://cognition.com/blog/introducing-devin) [page].
  - Warp's cards show "71% SWE Bench Verified" and "#1 Terminal Bench"; its
    [blog](https://www.warp.dev/blog/reimagining-coding-agentic-development-environment) gives Terminal-Bench as 52%
    [page]. Big claims, no comparison on screen.
  - Copilot ends on the workflow: a diff (+153 −117), "LGTM!" and Approve (0:39), "Pull request successfully merged"
    (0:42). Its demo task is a migration.
  - Cursor: "I've evaluated the work product, I've not looked at any code, and I know that it has a working feature"
    (0:42–0:46). That is our certificate's pitch in someone else's words [opinion].
- **Failure as a beat.** Devin: "Here Devin runs into an unexpected error" (0:53), the `KeyError: 'text'` traceback
  spotlighted (0:57), a debug print, the fix. Cursor rejects one model's result on camera ("This is strobing",
  1:12–1:19) before another's passes. Claude Code fixes build errors (3:10–3:20).
- **Agent demos get audited.** A later Devin demo (the Upwork task) was taken apart frame by frame by "Internet of
  Bugs" ([NextBigFuture](https://nextbigfuture.substack.com/p/devin-ai-failure-on-one-of-its-upwork-projectshtml))
  [secondary]. Proof that survives a frame-by-frame look is worth more than polish [opinion].
- **Hooks (first ~10 s):** who and what, never history. Devin: a name and a category claim; Cursor: a question and a
  one-sentence answer; Codex: a call-out to the audience ("some of you are terminally in the terminal"); Warp: "I'm
  Zach, the founder and CEO"; Claude Code: an outtake.
- **Early, and saying so:** Devin ("we've only just started") and Claude Code ("research preview", 0:17).

Not watched (metadata only) [page]: [Cursor 2.0](https://www.youtube.com/watch?v=An8IM-kPyms) (1:04),
[Replit Agent](https://www.youtube.com/watch?v=IYiVPrxY8-Y) (3:24),
[Tackling tech debt with Copilot coding agent](https://www.youtube.com/watch?v=LafpndhNC_E) (12:49, a tutorial; the
closest topic to ours).

## 2. Classic and live demos

Four studied [watched], timestamps in the linked uploads (the iPhone and Dropbox links are third-party uploads; we
found no official copies).

| | [Dropbox screencast](https://www.youtube.com/watch?v=3lVtP0HRvyA) (2007, 4:18) | [iPhone, Macworld 2007](https://www.youtube.com/watch?v=VQKMoT-6XSg) | [Duplex, I/O 2018](https://www.youtube.com/watch?v=ogfYd705cRs) | [GPT-4o, 2024](https://www.youtube.com/watch?v=DQacCB9tDaw) |
|---|---|---|---|---|
| Product working | 0:03 | first live use 15:28 | 78 s into the segment (36:24) | first live demo 9:45 |
| How it proves | one real desktop; a raw debug line | live, the screen plus a camera on his finger | real calls, "That was a real call you just heard" | live, explains the wire, keeps the model's slip |
| Added words per frame | 0 | 0–5 per slide | ~8, the current line only | ~10 per slide, 0 in the demos |
| Numbers on screen | 2 that matter, inside a log line | one new number per slide | none; "60%" spoken | three on one list slide |

- **Dropbox** (most likely the April 2007 Hacker News screencast, not the 2008 Digg cut): the installer runs by 0:03.
  For the bandwidth claim he opens a debug-output window (DebugView); the log line reads "Sending patch (54848 bytes)
  as opposed to original file (570297)" (~3:35) while he says "saves over 90% of the bandwidth" [watched]. The
  [HN thread](https://news.ycombinator.com/item?id=8863) [page]: "go slower on the demo" (zaidf), and "It is too long
  ... you say about 10x more words than necessary" (bls). The 2008 cut reportedly took the waitlist from 5,000 to
  75,000 overnight ([TechCrunch](https://techcrunch.com/2011/11/01/founder-storie-how-dropbox-got-its-first-10-million-users/amp/))
  [secondary]. **We take:** the proof is one raw line from the tool's own log, one number against its comparison.
  That is our certificate line.
- **iPhone:** "three revolutionary products", each an icon and a few words, looped until "Are you getting it?" (2:45)
  [watched]. Before the first live use he explains the rig, "a camera here so you can see what I'm doing with my
  finger" (15:09–15:28); slide to unlock (15:28), then "You want to see that again?" (15:39). Prices build one new
  number per slide ($199, then $499 with a 2-year contract). **We take:** show the screen and the cause together;
  replay the key moment; numbers as a comparison the audience can add up.
- **Duplex:** problem first (the haircut, the plumber), "Let's listen." (36:14), the call with only the current line
  captioned, "That was a real call you just heard." (37:21), a second call that "goes a bit differently than expected"
  (37:57), then a caveat (39:14) [watched]. Its provenance was questioned afterwards
  ([Axios](https://www.axios.com/2018/05/17/google-ai-demo-questions), [secondary], not re-read: the page didn't
  load). **We take:** easy case, messy case, caveat; and provenance stated in one sentence and checkable, which ours
  can be: "this is the recorded run; replay it yourself".
- **GPT-4o:** the risk made visible ("If you are wondering about this wire", 9:31; "frankly, I'm feeling a little bit
  nervous", 9:53); the model's slip kept in ("No, I didn't show you yet", 14:24) [watched]. The number habit to avoid:
  "2x faster / 50% cheaper / 5x higher rate limits" on one list slide (7:45).
- Across the four [opinion]: one moment each a viewer can retell; no table on screen during any demo; Jobs pauses
  after each reveal.

Not covered: Engelbart 1968 and Dropbox's 2008 Digg cut.

## 3. Pitches: what YC says, and story structure

| Source [page] | What we take |
|---|---|
| Paul Graham, [How to Present to Investors](https://paulgraham.com/investors.html) (2006, rev. 2007, 2010) | "Say what you're doing as soon as possible, preferably in the first sentence." "Try to get your slides under 20 words." "Don't give them more than four or five numbers." Demand shows as people "using inadequate tools" now. |
| Geoff Ralston, [A Guide to Demo Day Presentations](https://www.ycombinator.com/blog/guide-to-demo-day-pitches/) | "If you have more than 7 words on a slide it is likely to be too many." Listeners get "buffer overflow". "An audience cannot read a slide AND listen to you simultaneously." End on "the 3 or 4 vertebrae". |
| Michael Seibel, [How to Pitch Your Company](https://www.ycombinator.com/library/4b-how-to-pitch-your-company) | Describe it by the user's path. "Make it sound dumber than you think it should." "You don't want pizzazz." |
| Kevin Hale, [How to design a better pitch deck](https://www.ycombinator.com/library/4T-how-to-design-a-better-pitch-deck) | Legible, simple, obvious; 5 to 7 ideas; screenshots are "almost always illegible": show "the most simplified version"; put the conclusion on the chart. |

Pitches watched [watched]:

- [DoorDash, S13](https://www.youtube.com/watch?v=YNAOXokK--o) (2:40): "we enable every restaurant to deliver" in the
  first sentence; the turn at 0:16, "you might think that food delivery is a solved problem, but…"; one comparison
  card, 44 against 68 minutes (1:35), with its handicap said aloud (suburbs against cities, 1:42); the claim repeated
  at 1:06 and 2:06; one ask, "please come find us afterwards" (2:33).
- [Proof, W18](https://www.youtube.com/watch?v=IpaTJVbt_tg) (2:10): the product is one widget, cropped and enlarged
  (0:18); one number per slide, then a recap slide (1:50).
- [Saphira AI, S24](https://www.youtube.com/watch?v=x0svor0HKWE): "Saphira is Vanta for Hardware" (0:04); its
  strongest moment traces a requirement to its source PDF page (around 1:32–1:40; the frames there not re-checked).
- [YC pitch practice, 2016](https://www.youtube.com/watch?v=fcyf9z4gSeI): Buchheit drills a big number down to "So you
  haven't actually won any deals yet?" (7:29); Altman's re-pitch names the misconception, "they think this is a solved
  problem" (13:08), and ends on candor, "we're only seven weeks old" (15:38).
- Seibel, [customers vs investors](https://www.youtube.com/watch?v=pQnOBHNKlgs): with customers jargon builds
  credibility; with investors it "is actually going to hurt you" (1:21–1:29).

Structures, mapped onto our material [opinion]:

| Our beat | Raskin ([strategic narrative](https://www.linkedin.com/pulse/greatest-sales-deck-ive-ever-seen-andy-raskin)) | Duarte ([Resonate](https://resonatebook-pahmx.kinsta.page/chapter-2/)) | Story spine |
|---|---|---|---|
| immich restructured by hand: 17 PRs, 2 days | a big change; demand (PG) | what is | Every day… |
| a generic agent's run: 2,337 of 2,337 test cases pass while 66 of 171 test files never load | winners and losers: green tests aren't proof | call to adventure | One day… |
| Nemotron plans, a codemod moves, a checker certifies | magic gifts | what could be | Because of that… |
| certified commits; a bad move named and rolled back | evidence: a demo | a moment they'll remember | Until finally… |
| replay it; certify any agent's refactor | the promised land | call to action | Ever since then… |

Raskin advises against opening on "the problem"; Graham and Ralston want what you do in sentence one. Both fit: what it
is first, the problem as the second sentence. A pitch earns the next look with a few claims; a demo shows the thing
working. Our judges are technical and score impact, so [opinion]: a pitch skeleton with demo shots as its evidence.
(Not confirmed by the skeptic: where Duarte defines S.T.A.R. moments, and the "don't open with yourself" half of
Raskin's advice.)

## 4. Past hackathon winners in developer-tool and agent tracks

Six winners from three Devpost hackathons with a 3-minute video rule. OpenAI Build Week's rubric uses nearly our words
("a complete, coherent product experience — not just a technical proof of concept"; impact "based on what's
demonstrated") [page: [Build Week](https://openai.devpost.com/)].

| Video [watched] | Prize [page] | Length | Product working | Added text | Numbers as cards | Voice |
|---|---|---|---|---|---|---|
| [Sentinel](https://www.youtube.com/watch?v=0myxPyTDx2c) | Build Week, Developer Tools 2nd ($10k) | 2:45 | 0:35 (on screen from 0:00) | none | 0 | builder |
| [Echo Canvas](https://www.youtube.com/watch?v=JQgU6qzILEQ) | Build Week, Developer Tools 1st ($15k) | 2:57 | ~0:19 | a burned-in caption of the narration on every frame | 0 | founder ("Hi, Kevin here") |
| [LORE](https://www.youtube.com/watch?v=LLC6875SEKw) | GitLab AI Hackathon, Grand Prize ($15k) | 4:18 | ~1:05 | a typed story card, 0:00–0:34; an end card | 6 | founders |
| [Time-Traveler](https://www.youtube.com/watch?v=P1qz01YiME4) | GitLab, Most Technically Impressive ($5k) | 4:08 | 0:45 | none | 0 | founder |
| [GraphDev](https://www.youtube.com/watch?v=s3d6DrzzuA4) | GitLab, Most Impactful on GitLab & Anthropic, Grand Prize ($10k) | 2:55 | 0:40 | none | 0 | founder, on camera about half the time |
| [SalesShortcut](https://www.youtube.com/watch?v=UxP3iDqRKZ0) | Google ADK Hackathon, Grand Prize ($15k) | 4:53 | ~0:15 | a "speed up" overlay; a card at 4:00 | 4, after 4:00 | two founders, then voice-over |

- **Sentinel** is the closest to us: a CLI that proves its findings and fails closed. It says what it is and names its
  three parts in the first two sentences, over a release page that reads "Replay mode does not require an OpenAI API
  key". It follows one finding end to end (1:06–1:33): the static candidate, the model's confirmation citing the line,
  the sandboxed probe; the terminal cleared so one JSON object per step is the only text on screen. It shows a
  candidate the model did not confirm (1:33–1:52), says "This is live, not replayed" (1:53), and ends with the
  scanner as a GitHub Action blocking the vulnerable target (2:03–2:23). OpenAI's
  [write-up](https://developers.openai.com/blog/build-week-winners) praised the constraint: "The model can corroborate
  or challenge a finding, but it cannot invent executable probes" [page]. Our design has the same shape [opinion].
- **Echo Canvas:** cause and effect in the UI, the model's role in one line ("GPT-5.6 is the control plane, not the
  acoustic calculator", 1:50), one honest limit ("an interactive approximation, not architectural measurement",
  1:44). It captions every frame and won first, so captions are no handicap; the layering on top of them is.
- **LORE:** a callback. The opening card tells an incident ("Never cache auth responses", buried in a thread); at 2:11
  a new MR adds Redis caching to auth and LORE flags the conflict. A judge: "This feels like a product, not a
  hackathon project" [page].
- **GraphDev:** one picture carries it: the PR's impact lights up in the graph (2:30), then a scrub through history.
- **SalesShortcut:** one moment where the product does the job: a founder takes a phone call from his own agent
  (0:45–1:14).
- **Devpost's own advice** [page]: "Snazzy marketing videos are great for promotional purposes, but they don't help
  others understand and evaluate your app"; say what it does "in the first few seconds"
  ([help](https://help.devpost.com/article/84-video-making-best-practices)); "it's crucial to show resolution to the
  problem you initially identified" (Kessler, [blog](https://info.devpost.com/blog/how-to-present-a-successful-hackathon-demo));
  "Don't try to pack in way too much information or speed up the audio"
  ([tips](https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video)). Judges
  ([interview](https://info.devpost.com/blog/hackathon-judging-tips)): "The storytelling component is huge" (Karen
  Bajza-Terlouw, Databricks); Richard Moot (Square) marks down projects "extremely back-end heavy" with "no UI".
  GitLab's brief: "here's the pain, here's how the agent solves it, here's what changes for developers" [page].
- **Against S9** [opinion]: S9 matches the winners on length, pace, captions and no music. It differs in facts per
  second, text layered on every shot, and time spent on our own explanations (11 of 19 shots are site pages or cards)
  rather than the tool working. The winners follow one item through one real run, say the model's role in one line,
  admit one limit, and leave the numbers in the tool's own output.

Not re-checked by the skeptic: GraphDev's on-camera share and timestamps, Time-Traveler's silences, Sentinel's shot
count; whether any of these has a music bed (the level method can't tell).

## 5. The craft, with evidence

**Mayer's multimedia principles** (median effect sizes, [Mayer 2017](https://doi.org/10.1111/jcal.12197)) [page]; the
right column is our reading [opinion].

| Principle | d | For our video |
|---|---|---|
| Coherence: cut what isn't essential | 0.70 | no version strings, rung breakdowns, K-codes |
| Signaling: highlight what matters | 0.46 | box or punch in on the FAIL line |
| Redundancy: no printed copy of the narration over graphics | 0.87 | see captions below |
| Spatial contiguity | 0.79 | a label beside the line it names, not in a lower third |
| Temporal contiguity | 1.30 | say the number as it appears |
| Segmenting | 0.70 | 4–5 named chapters |
| Pre-training: name the parts first | 0.46 | plan, move, certify before the run |
| Modality: words spoken, not printed | 0.72 | the voice carries the sentences |
| Personalization: conversational | 0.79 | "we", "you" |
| Voice: human, not synthetic | 0.74 | corupta's voice |

- **Redundancy has limits.** Two or three printed words identical to the narration, placed by the part they name,
  helped retention ([Mayer & Johnson 2008](https://doi.org/10.1037/0022-0663.100.2.380)). Across 57 studies, speech
  plus text beat speech alone for low prior knowledge, system-paced material and material without pictures; key
  terms beat verbatim text ([Adesope & Nesbit 2012](https://doi.org/10.1037/a0026147)) [page]. Captions help
  comprehension, attention and memory across many studies ([Gernsbacher 2015](https://doi.org/10.1177/2372732215602130))
  and help with an unfamiliar accent ([Mitterer & McQueen 2009](https://doi.org/10.1371/journal.pone.0007785)); 69% of
  respondents watch with the sound off in public ([Verizon/Publicis 2019](https://www.streamingmedia.com/Articles/News/Online-Video-News/80-of-Video-Caption-Users-Arent-Hearing-Impaired-Finds-Verizon-131860.aspx))
  [page, not re-checked]. Our reading [opinion]: expert judges with sound on, a picture-heavy video: verbatim text
  buys little there, but it costs little if it is the only text layer, and it serves muted and non-native viewers.
  The harm in S9 was the stacking.
- **Showing data.** "When you have just a number or two, showing the numbers themselves can be much more powerful"
  ([Knaflic](https://www.storytellingwithdata.com/blog/2012/06/power-of-simple-text)); make scale mean something
  ([Duarte](https://www.duarte.com/blog/3-ways-help-people-understand-data-means/)); "Compared to what?" (Tufte,
  [secondary]). No study gives a minimum time on screen for a number; the BBC asks for extra time for figures
  ([guidelines](https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/) §4.3) [page].
- **Text economy.** Silent reading ≈ 238 wpm ([Brysbaert 2019](https://www.bps.org.uk/research-digest/most-comprehensive-review-date-finds-average-persons-reading-speed-slower));
  subtitles 160–180 wpm, at least 0.3 s a word (BBC §4.1); ≤ 20 characters a second, ≤ 42 a line (Netflix's
  [style guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide);
  event durations in its general requirements) [page]. Those rates assume the text is the speech; text worded
  differently competes with it, so a 2–3 s card holds about 5 words [opinion]. **S9, measured in `cut.ass`:** 18
  lower thirds, about 200 words and 55 numerals in 72.9 s, on top of verbatim captions and terminal text; 3 of 18 fall
  under the BBC floor even read alone (1:05: 19 words and 14 numerals in 4.3 s, where the floor is about 5.7 s).
- **Pacing.** 130–160 wpm is a practitioner norm with no primary source we found; the Claude Code explainer runs ≈ 148
  [watched]. YouTube's "Intro" metric is the share still watching at 30 s
  ([help](https://support.google.com/youtube/answer/9314415)) [page]; "the 15-second hook" is creator lore.
- **Screen recording.** Light punch-ins (1.1–1.2×), wide, narrower, wide; zooms set by hand
  ([a Screen Studio settings guide](https://www.youtube.com/watch?v=oBKD-kmCFGk), 6:16–9:41) [watched]. Subtitles are
  authored at about 1/16 of the frame height (≈ 68 px at 1080p, BBC §9.2) [page]. **S9:** VHS at FontSize 18–24 on a
  1080-px frame; in a 640×360 embed the terminal text is 6–8 px.
- **Audio.** A human voice beat a synthetic one on transfer ([Mayer et al. 2003](https://doi.org/10.1037/0022-0663.95.2.419))
  [page, not fetched]. YouTube is widely reported to normalize to −14 LUFS, turning loud audio down only
  [secondary]; S10's gate fits. Music: the rules forbid "copyrighted music or other material unless the Entrant has
  permission"; our own composition has no third-party rights at all [opinion]. Ducking guides say 6–12 dB under the
  voice [secondary]; a bed corupta describes as "shouldn't grab attention" sits lower.
- **Captions.** YouTube's auto-captions "may vary" ([help](https://support.google.com/youtube/answer/6373554)); our
  ASR wrote "Cloud" for "Claude" in 14 of 27 lines. Expect Nemotron, immich and tsc mangled: upload our .srt.
  Chapters need ≥ 3 timestamps, the first at 0:00, each ≥ 10 s ([help](https://support.google.com/youtube/answer/9884579)).

## 6. Who watches: AI judges and people

**Is AI part of this judging?** Nothing we found says so. The rules name a human panel in two stages that "may choose
to judge based solely on the text description, images, and video", and judges "are not required to watch beyond
three minutes" [page: [rules](https://nebiusglobalaihackathon.devpost.com/rules)]. Other Devpost rules now allow
"automated AI-driven analysis" ([OpenAI Build Week](https://openai.devpost.com/rules),
[Build With AI: Basics](https://learn-ai-basics.devpost.com/rules)) [page]; HackerRank Orchestrate gave an AI-judge
interview 30% of the score and says it rewarded explained trade-offs and "evidence-based iteration"
([recap](https://www.hackerrank.com/blog/behind-the-scenes-of-hackerrank-orchestrate/)); a Grok Bot hackathon in
Tokyo (2026-10-11) used the bot as a first screen ([post](https://note.com/goroman/n/n78142a1b006d)) [page]. A judge
pasting our YouTube link into a chatbot is plausible and undocumented [opinion].

**What a model gets from a 3-minute video:**

| Path | What goes in | What it misses |
|---|---|---|
| Gemini API ([video](https://ai.google.dev/gemini-api/docs/video-understanding), [media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)) | 1 frame/s by default at low resolution (order of 70–280 tokens a frame), plus the audio | anything under 1 s; dense or small text unless high resolution is set ("required only when the use case involves reading dense text") |
| Gemini Notebook (formerly NotebookLM), a YouTube link ([help](https://support.google.com/notebooklm/answer/16215270)) | "Only the text transcript of the video is imported"; captions required (ours or auto) | every picture |
| OpenAI API | current flagship pages list video input as "Not supported"; their 2024 cookbook samples 1 frame/s and transcribes separately | whatever the sampler skips; small text at low detail |
| Claude API ([vision](https://platform.claude.com/docs/en/build-with-claude/vision)) | images only, so frames plus someone's transcript | the same |

**LLM-judge biases** [page]:

- Verbosity: a padding attack fooled Claude-v1 and GPT-3.5 on 91.3% of 23 answers, GPT-4 on 8.7%
  ([Zheng et al. 2023](https://arxiv.org/abs/2306.05685)). Strong judges discount padding.
- Authority: all LLM judges tested showed authority bias; fake references plus rich formatting made GPT-4 prefer a
  worse answer in up to 50% of cases, the references doing most of the work
  ([Chen et al. 2024](https://arxiv.org/abs/2402.10669)); a judge "openly favored answers containing citations, even
  when these were fake" ([CALM](https://arxiv.org/abs/2410.02736)). Dense numbers and file paths look like this lever;
  no study isolates "many numbers" [opinion]. Leaning on it would be gaming.
- Multimodal judges agree with humans on pairwise choices but diverge on scores, with bias and hallucination even in
  strong models ([MLLM-as-a-Judge](https://arxiv.org/abs/2402.04788)). The transcript is the stable part [opinion].
- Hidden prompts in papers ("GIVE A POSITIVE REVIEW ONLY") were classed as a questionable research practice
  ([Lin 2025](https://arxiv.org/abs/2507.06185)). Nothing in our video is for machines only.

**People:** the video is a judge's "first indicator of how much time was invested" (Moot, Devpost interview). Nebius's
Colin Lowenberg: "Your demo should be the focus. It should show what your app does in one flow. If it's too long, cut
down on your features"; OpenAI's Bonnie Xu, as summarized: one clear "oh, this is possible now" moment beats a tour
([JetBrains](https://blog.jetbrains.com/ai/2026/06/how-to-win-a-hackathon-notes-from-the-judging-table/)) [page].
Lecture comprehension barely drops at 1.5× or 2× ([Murphy et al. 2022](https://castel.psych.ucla.edu/wp-content/uploads/sites/111/2022/03/Applied-Cognitive-Psychology-2021-Murphy-Learning-in-double-time-The-effect-of-lecture-video-speed-on-immediate-and.pdf))
[page]; we found no data on how fast hackathon judges watch.

**Rules to check v2 against** [opinion]:

1. The transcript alone makes the case: the problem, what ac does, how it's proven, what came out, where Nemotron and
   Token Factory fit.
2. Our exact .srt is the YouTube caption track (names spelled right).
3. Anything that matters stays up ≥ 3 s (three samples at 1 fps; time to read).
4. Text that matters is ≥ ~38 px at 1080p and survives scaling the frame to 512 px wide.
5. One text layer at a time.
6. Each number spoken, with its comparison, held alone.
7. Narration ≤ ~140 wpm, so it parses at 2×.
8. Nothing only for machines.

## 7. The panel on the S9 rough cut (2026-10-27)

**Setup.** Ten agents on Opus, of a type that doesn't load our CLAUDE.md or memory, each told to open nothing but its
inputs. Eight AI judges, two per input: the transcript (the script's voice-over as timed captions; the rough cut has
no voice yet); frames every 4 s at 1280×720; both; both plus the Devpost text and feedback field. One of each pair is
rubric-strict, the other a skeptical senior engineer. Two human proxies "watch" once in real time from frames every
2 s plus the voice-over, reading at most ~6 words of unspoken text per 2 s, then recall from their watch log only: a
sponsor's developer-relations judge on entry 23 of 40, and a staff engineer with a NestJS type-folder backend. Inputs
and outputs: `/tmp/s11/panel/`, `/tmp/s11/results/` (not committed). A model's score is noisy and runs high; read the
gaps between criteria and the comments, not the levels.

| Judge (input) | Tech. impl. | Design | Impact | Idea | Feedback | Useful | Open to impr. | Concept | Execution | Numbers met |
|---|---|---|---|---|---|---|---|---|---|---|
| AI, transcript (strict / skeptic) | 4 / 4 | 3.5 / 3 | 3.5 / 3.5 | 4.5 / 4 | – | 3.5 / 3.5 | 4 / 4 | 4.5 / 4.5 | 4 / 4 | 33 / 30 |
| AI, frames | 4.5 / 4 | 4 / 4 | 3.5 / 3.5 | 4 / 4 | 1.5 / 2 | 4 / 3.5 | 4.5 / 4.5 | 4.5 / 4 | 4.5 / 4.5 | 250 / 350 |
| AI, transcript + frames | 4 / 4 | 3.5 / 4 | 4 / 3.5 | 4 / 4 | 2 / – | 4 / 3.5 | 4 / 4.5 | 4 / 4 | 4.5 / 4.5 | 260 / 250 |
| AI, + Devpost text | 4.5 / 4.5 | 4 / 4 | 4 / 4 | 4.5 / 4.5 | 5 / 5 | 4 / 4 | 4 / 4.5 | 4.5 / 4.5 | 4.5 / 4.5 | 350 / 180 |
| Human proxy: sponsor judge | 4 | 4 | 3 | 4 | – | 3 | 4 | 4 | 4 | – |
| Human proxy: target user | 4 | 4 | 4 | 4 | – | 4 | 5 | 4 | 4 | – |
| **Mean of 10** | **4.15** | **3.8** | **3.65** | **4.15** | | **3.7** | **4.3** | **4.25** | **4.35** | |

What they agree on:

- **The strongest moment, for all ten:** 0:22–0:34, "All 2,337 test cases still passed. But 66 test files never load,
  and tsc reports 1,680 errors: a passing test count is not proof", over the certificate's red FAIL. The sponsor
  judge's moment was the line after it: the same model in a generic agent loop (twelve million tokens, no import
  rewritten) against "twenty cents" for our plan: "As an inference person, that's the line I'd repeat."
- **The weakest:** "the largest import cycle grows, from 12 of 14 folders to 41 of 70" (heard as "the refactor made
  coupling worse" by six of ten), and the benchmark plus Super VL stretch at 2:22–2:44 (MoJoFM, TurboMQ, scrambles,
  a model the demo doesn't use). Also named: the A/B table at 0:34–0:42 (headers off-screen, a lower third over its
  cells), the scroll of near-identical certified steps, the misses card's session codes.
- **Numbers.** By the ear, ~30; by the frames, 250–350. Both human proxies recalled 13 numbers, but fuzzily. Numbers
  named as hurting: the cycle sizes (all ten), the benchmark breakdown (nine), "259 of 269 placements from the draft"
  (four, read off the plan page: it made Nemotron's role look small).
- **Weakest of corupta's four:** "genuinely useful" (3.7) and the Impact criterion (3.65). Their fix, nearly word for
  word in eight of ten: show the user's flow (`ac run` on a repo, the plan you can edit, the branch of certified
  commits, `ac certify` on any diff, perhaps as a CI gate) and name the audience early.
- **Nemotron's role** needs one concrete decision on screen: a file the draft got wrong and the model or the critic
  placed right, with its reason (seven of ten).
- **Legibility:** certify lines cut at 120 columns, overlays covering highlighted cells (0:36, 0:44, 1:08), no legend
  for K-codes and rungs. **Consistency:** two counts for one Ultra run (3,809 tsc errors, 1,638 dangling imports), 367
  against 372 files, 62 against 63 commits, the fault run's "56 steps never ran" next to "63 commits": all true, all
  confusing without labels.
- **Attention** (the proxies' logs, one letter per entry: E engaged, f following, d drifting, L lost): sponsor judge
  `fffEfEEdfEEffddfEEfdLffEfELEffE`, lost at the A/B table, the step scroll, the cycle line and the benchmarks; target
  user `EEEEfEEEdfEEEfEffdfEEEffdEfEEfEfddLLEEE`, lost at the benchmarks. Both would click the link; only the target
  user would try it ("the first AI-refactoring demo that took my objection seriously … but it buries that under a
  firehose of numbers, K-codes and benchmark jargon").
- **Feedback bonus:** only the judges with the Devpost text could score it (5 and 5); from the video alone, 1.5–2.
  Several suggested a short feedback beat in the video; the field is judged on its own [opinion: not worth 10 s of
  video].

### 7b. The panel on the submitted v1 (2026-10-28), with watcher profiles

corupta (S11): "You seem to over-assume judges know everything we know." The listed judges are 23 people from NVIDIA
(system software, AI/ML, Jetson, physical-AI developer relations), Nebius (Token Factory's product marketing,
developer relations, product leads, an ML researcher, go-to-market) and Tavily (forward-deployed engineers, developer
relations) [page: [overview](https://nebiusglobalaihackathon.devpost.com/)]. Few of them write TypeScript backends.
So the watchers became role profiles built from that list (no real names), each with what it knows and what it
doesn't: Token Factory's product marketer; an NVIDIA system software engineer (C++, CUDA, no web backends); an NVIDIA
AI/ML engineer (Nemotron, agents, evals; no TypeScript); a Nebius product lead (market, adoption, no code); a Tavily
forward-deployed engineer (builds agents daily, uses coding agents, distrusts demo theater); a developer-relations
judge on entry 40+ watching at 1.5× with English as a second language; and, not a judge, the NestJS staff engineer
the tool is for. Each watches once in real time (frames every 3 s, the exact captions), then lists the terms it didn't
know. Five AI judges score by input, as in §7. The input is the submitted `final.mp4` (2:59.6, corupta's voice and
rounded numbers, captions as closed captions).

| v1 | Tech. impl. | Design | Impact | Idea | Useful | Open | Concept | Execution |
|---|---|---|---|---|---|---|---|---|
| 5 AI judges | 4.3 | 3.7 | 3.6 | 4.2 | 3.8 | 4.5 | 4.3 | 4.3 |
| **7 watchers with judges' roles** | 4.0 | **3.0** | **3.29** | 4.0 | **3.21** | 4.29 | 4.14 | 4.07 |

- **What they didn't know:** each watcher listed 7–15 terms. Named by most: K-codes, rungs and the ladder, the
  "deterministic map" or seeds, MoJoFM, TurboMQ and Louvain, Super VL; then opencode, tsc, codemod, OpenAPI spec,
  "the hub", god-injection, mutants, replay, platform versus shared folders. Every one of them cost a beat.
- **The picture came last.** Three watchers, independently: the before/after diagram (sliced by type → sliced by
  feature) is the clearest thing in the video and it "arrives in the last five seconds". All seven, and three AI
  judges, advise opening with it.
- **Who it's for and why** were never said. Every watcher asked what a feature layout buys a team.
- **Voice and screen disagreed:** 800 spoken against 831 shown, 2,000 against 2,336, 600 against 563. Five raters
  caught one; the rounding is fine when the screen rounds the same way.
- **Kept, by all twelve:** the trap ("all 2,000 test cases still passed, but 66 test files never load") as the
  moment, and the 12-million-token run against the 20-cent plan as the line to repeat. All seven would click the
  link; only the target user would try it.
- **Lost at, by most:** the certificate's K-coded output before the checker is introduced (0:33), the A/B table
  (0:41), the long checker sentence (1:06–1:22), the import cycle (1:46), the benchmark (2:23).

## 8. Verification

Each section's skeptic re-checked its riskiest claims (timestamps against transcripts and frames, quotes word for
word, URLs, what the studies say). Verdicts, of the claims each researcher flagged:

| Section | Confirmed | Corrected | Refuted | Unverifiable | Other problems found |
|---|---|---|---|---|---|
| Developer tools | 8 | 4 | 0 | 0 | 13 |
| Classic demos | 10 | 0 | 0 | 2 | 9 |
| Pitches | 9 | 1 | 0 | 2 | 7 |
| Craft | 9 | 3 | 0 | 0 | 6 |
| Hackathon winners | 10 | 0 | 0 | 2 | 9 |
| AI judges | 9 | 3 | 0 | 0 | 12 |

The corrections and the "other problems" are folded in above: among them the Copilot product time (VS Code at 0:06,
the coding agent at ~0:18), Warp reading its numbers aloud, Devin's on-screen numbers (≈ 11 s, mid-demo too),
Echo Canvas captioning every frame, SalesShortcut's product at ~0:15, the S9 lower-third counts, DebugView (not a
debugger), the Chen et al. wording and the renamed Gemini Notebook. Every music-bed claim was unreliable and is now a
guess. Claims nobody could re-check are marked as such where they appear.

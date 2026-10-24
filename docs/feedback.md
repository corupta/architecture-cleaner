# Feedback on Nebius Token Factory and NVIDIA Nemotron

From architecture-cleaner (`ac`), an entry in the Nebius x NVIDIA Global AI Hackathon. From 2026-10-02 to 2026-10-24
every model call went through Token Factory: 857 chat completions on four Nemotron models (3 Ultra, 3 Super, 3.5
Lightning, 3.5 Super VL), $35.96 at list prices. Our gateway recorded each request and response (`cassettes/*.jsonl`)
and each call's usage and cost (`budget/ledger.jsonl`), so every item below cites a recording or a page, not a memory.
Each item was checked a second time by an agent told to refute it, and the docs items were re-read on 2026-10-24.
Each one says whose it is: Token Factory's (the API, the docs, the catalog, billing), the model's (for NVIDIA), or
ours. The running log behind this write-up is [feedback-log.md](feedback-log.md); the item numbers continue it.

Where the evidence is: in this repository (the cassettes, the ledger, [gates/tf-probes.md](gates/tf-probes.md),
[bench/experiments/s8b-super-vl](../bench/experiments/s8b-super-vl/README.md)), on the branches `spike/gates` and
`spike/g3-ultra` (the probe and baseline ledgers), and, for the generic-agent runs whose prompts carry immich's
source, in recordings we keep outside the repository.

## The ten we'd fix first

1. **The serverless prompt cache is shared across organizations** (#38). The Cached Tokens page says so, caching
   can't be turned off, and `cached_tokens` in every response tells a caller whether a prefix was recently sent by
   anyone. That is a cross-tenant side channel on prompt content. Scope the cache per organization by default, or
   offer an opt-out, and say so in the legal guide's zero-data-retention section.
2. **Prices changed mid-hackathon with no effective date** (#37). Cached input became 80–88% cheaper between the
   2026-10-16 and 2026-10-23 catalog snapshots, with no changelog. A client that keeps its own ledger can't know
   which price applied to which call. Publish a dated pricing changelog.
3. **Non-streamed calls die at 600 s with an HTML 504** (#30). No docs page mentions the limit, the body isn't JSON,
   there is no request id, and nobody can say whether the cut call is billed. Document it, return a JSON error with an
   id, and reject or warn on a non-streamed `max_tokens` that can't finish in time.
4. **Super silently stops at 32,768 output tokens** (#31), even when `max_tokens` is 64,000, with `finish_reason:
   length` and no warning. We misread it as the model reasoning too long. Publish max output tokens per model, and
   reject or visibly clamp a larger `max_tokens`.
5. **The rate limiter counts characters, not tokens** (#42). The token headers subtract `floor(characters / 4) + 512
   × n`, never output, and a 9-minute burst at about three times Ultra's limit got neither a 429 nor the documented
   over-limit flag. Say what the counter counts, and enforce or flag as documented.
6. **Strict `json_schema` lets a choice burn its whole budget on whitespace** (#32). Three recorded choices wrote a
   valid JSON prefix and then whitespace until `max_tokens`. Bounding whitespace in the grammar would remove that
   failure for every model.
7. **Ultra returns its truncated reasoning as `content`** (#33, extending #21). In a production call, 247,147
   characters of looping reasoning came back as the answer of a strict-schema request, while usage counted them as
   reasoning tokens. Super VL handles the same case correctly; use its parser.
8. **Reasoning controls and budgets are undocumented** (#52, with #4 and #19). Super VL with thinking on needs a median
   of about 118k tokens per answer on our task, and nothing documents an effort level or a budget that bounds it.
9. **The catalog hides structured output on Nemotron** (#49, with #1 and #18). Strict `json_schema` holds on every
   Nemotron model we used, yet none carries the JSON-mode tag, so a builder filtering the catalog never finds them.
10. **The docs' code samples use models Token Factory no longer serves** (#50, extending #8). Twelve ids, the
    Quickstart's among them; only 3 of the sampled ids are live, and no sample uses Nemotron.

## Token Factory: API behavior and limits

**30. Non-streamed requests are cut at 600 s.** On 2026-10-21 a non-streamed Nemotron 3.5 Super VL request (`n=3`,
`max_tokens` 256,000, thinking on by default) failed after 600,372 ms with HTTP 504. The body was nginx's HTML "504
Gateway Time-out" page, not a JSON error, and it carried no `x-request-id` (all 124 of our recorded 200 responses do),
no rate-limit headers and no `retry-after`. A non-streamed answer sends its headers only when it's done, so the client
sees nothing for ten minutes. At Super VL's ~245 tokens/s per choice, the limit caps a non-streamed choice near 145k
tokens, while its finished answers needed a median of ~118k and 8 of 45 reached 256k. We booked the call at our $0.70
estimate, because nothing says whether a cut call is billed. It cost us a streaming transport, with an event
assembler and idle timeouts, for every request above 64k `max_tokens` (`src/gateway/request.ts`,
`src/gateway/transport.ts`). Related trap, in Node rather than Token Factory: undici's default `headersTimeout` is
300 s, and our longest successful non-streamed Ultra call took 358 s. *Evidence:* `budget/ledger.jsonl` line 274;
the 504 record in `cassettes/s8b-bench.jsonl`. *Fix:* document the limit and recommend streaming for long
generations; return a JSON error with a request id; state whether a cut generation is cancelled and billed; reject or
warn when a non-streamed `max_tokens` can't finish in 600 s.

**31. Nemotron 3 Super clamps output at 32,768 tokens.** In our G1 gate (2026-10-02, non-streamed, strict
`json_schema`), every Super choice that ended at `length` under `max_tokens` 64,000 stopped at exactly 32,768
completion tokens, reasoning included: three `n=1` calls report 32,768, two `n=2` calls 65,536, and three mixed `n=2`
calls fit the same cap. No error, no warning. Ultra and Super VL used their full `max_tokens` in all 18 of their
length-ended calls, up to 512,000. The catalog gives Super only `context_length` 262,144; models.dev, which opencode
reads, says 32,768. Our gate report read these as reasoning overrun: 10 of the 11 Super choices G1 counted as
unfinished were this clamp, about $0.03 each for nothing. *Fix:* publish max output tokens per model in the catalog,
and reject or visibly clamp a `max_tokens` above it.

**32. Strict `json_schema` allows unbounded whitespace.** Three recorded choices wrote a valid JSON prefix and then
only whitespace until `max_tokens`: an Ultra plan edit (2026-10-17, 64k cap: 2,892 characters of JSON, then 86,202 of
whitespace), an Ultra critic (2026-10-20, 32k cap: 3,284, then 27,037, so that run got no critique) and a Super VL
probe (2026-10-20, 8k cap: 204, then 10,688). The repetition is the model's, but the grammar is what lets it run to the
cap, and each such choice is billed in full (up to $0.19 on Ultra). The serving stack is vLLM (`system_fingerprint`),
whose structured-output backend can forbid free whitespace (we haven't checked which version Token Factory runs).
*Evidence:* `cassettes/s7-bench.jsonl`, `cassettes/s8b-bench.jsonl`, `cassettes/s8b-probes.jsonl`. *Fix:* bound
whitespace in strict mode.

**33. Ultra's truncated reasoning leaks into `content` in production** (extends #21). In two real calls (a plan
edit and the planner's file summaries; `n=3`, `max_tokens` 64,000, `medium_effort`, strict `json_schema`), a choice ran out while still reasoning and came
back with `reasoning_content` null and the raw reasoning in `content`: 166,208 characters ending in "Now file 11."
repeated (2026-10-07), and 247,147 characters ending in a repeated module list (2026-10-20). Usage counts those tokens
as reasoning (77,705 of 85,341 and 89,823 of 92,758 completion tokens), so the server knows what they are and still
returns them as the answer. A client that trusts the schema gets prose. Super VL got this right in all 22 of its
truncations during reasoning. Each leak costs ~64k output tokens ($0.19). *Fix:* the same reasoning parser on every
deployment.

**34. `guided_json` is accepted and ignored.** On 2026-10-02 a top-level `guided_json` schema sent to Super, Ultra and
Lightning (thinking off) returned 200 with an unconstrained answer, no warning. Yet the text-generation example in the
API reference, introduced as a request "that includes all supported fields", sends `guided_json`, and the JSON-mode
page links a cookbook notebook named `guided_json.ipynb`. Only strict `response_format: json_schema` is enforced.
*Evidence:* [gates/tf-probes.md](gates/tf-probes.md). *Fix:* honor it or reject it with a 400, and drop it from the
example.

**35. `GET /v1/models/{id}` returns 404 for every model.** On 2026-10-02, `GET /v1/models/nvidia/Nemotron-3-Ultra-550b-a55b`
(the exact catalog id) returned 404 `{"detail":"Not Found"}`, twice. Every id in the catalog contains a slash, so the
OpenAI-compatible retrieve call finds none of them; only the list works. (We didn't try `%2F`.) *Fix:* serve slash
ids, or document that only the list is supported.

**36. What a cut or disconnected call costs is undocumented, and usage can't be looked up afterwards.** On 2026-10-02
our client gave up on a non-streamed Super call after 300 s (undici's default timeout: our bug). Token Factory
finished it and billed it, as one would expect; we only found out on 2026-10-14, when the console showed about 58k
more Super output tokens than our ledger. No API returns a request's usage after the fact, and the Observability page
covers dedicated endpoints only ("not for billing reconciliation"). The 504 in #30, and a Super VL call we killed
mid-flight, are in the same state: billed amount unknown. *Fix:* document that generation continues and is billed
when a client disconnects (or cancel it); offer a per-request usage export, or accept a client-supplied request id.

## Token Factory: billing, pricing and caching

**37. Cached-input prices appeared mid-hackathon with no effective date** (extends #13). On 2026-10-02 the listing
had `input_cache_read` null for every model. The 2026-10-14 console bill charged ~161k Ultra cache-hit tokens at the
full $1.00/M. The public catalog snapshot of 2026-10-16 14:11 UTC has no cached price; the one of 2026-10-23 13:01 UTC
prices cached input for 19 of 30 models: Ultra $0.12/M (against $1.00), Super and Super VL $0.06/M (against $0.30),
none for Lightning or Nano. A Cached Tokens page appeared in the same window (absent from the docs index of
2026-10-04). There is no changelog entry or effective date, and the ideas-board request for cache pricing still reads
"In Review" (last modified 2026-03-16). *Impact:* our ledger charges full price and can't tell which calls got the
discount. G3's Ultra arm ran on 2026-10-24 with 11,989,760 of its 13,562,215 input tokens cached: $13.70 at full price
in our ledger, about $3.15 at the cached price. Only a console bill can settle which applied. *Fix:* a dated pricing
changelog with per-model effective dates.

**38. The serverless prompt cache is shared across organizations.** The new Cached Tokens page says the serverless
cache is "shared within a model ... This doesn't depend on the organization, project, or API key"; caching is
implicit, with no opt-out and no configurable keys; it "works the same way" under zero data retention; cached tokens
are reported in the usage of every response; only dedicated endpoints get an isolated cache. Its advice is "Don't put
secrets in the beginning of a prompt". Together these let any customer test whether a guessed prompt prefix was
recently sent to the same model by another organization, read straight from `cached_tokens`: the cross-user cache side
channel audited in Gu et al., "Auditing Prompt Caching in Language Model APIs" (arXiv 2502.07776, 2025). The legal
quick guide, ZDR section included, says nothing about cache scope. For us: `ac`'s prompts start with a system prompt
that is public in this repository, followed by the target's file paths; on a private repository, another tenant could
rebuild that prefix and confirm guessed paths. We didn't probe it live (our budget was frozen); this rests on the page's
own statements. *Fix:* scope the serverless cache per organization by default, or offer an opt-out, and state the scope
in the legal guide.

**39. The cache's block size is undocumented, and Super never hit.** The page says hits are "rounded down to a block
boundary". Every Ultra hit we recorded is a multiple of 4,352 tokens (263 calls with hits), and every Super VL hit a
multiple of 2,176 (41 calls). So on Ultra a prefix under 4,352 tokens never hits, and the page's own example (3,072
cached tokens) can't occur there. Nemotron 3 Super reported 0 cached tokens in 351 calls and 19,589,035 prompt tokens
on 2026-10-02, including an agent loop whose prompts grew around a shared prefix to 116,810 tokens, while Ultra cached
40.1% of its prompt tokens the same day and 90% of the same agent workload on 2026-10-24. The catalog now lists a
cached price for Super. *Fix:* publish the block size per model, and say per model whether caching is active.

**40. The Cached Tokens page contradicts itself on cache keys.** It says "You can't configure cache keys" and, a few
lines earlier, how `prompt_cache_key` behaves ("it only helps route requests to the server that holds the cache"). In
the OpenAPI spec, `prompt_cache_key` exists only on the Responses request, with OpenAI's description ("Used by OpenAI
to cache responses..."); the chat request doesn't define it but accepts additional properties, so sending it has an
undocumented effect. *Fix:* one statement, and the field documented where it works.

**41. Usage has a different shape per model and per stream mode** (extends #27). Ultra (non-streamed) returns
`prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` plus `prompt_tokens_details` {audio, cached, multimodal}; Ultra
streamed returns only `cached_tokens`. Super VL has no hit/miss pair at all; its details carry `created_cache_tokens`
(undocumented) and lose audio and multimodal when streamed. Lightning's `prompt_tokens_details` is null, which
contradicts the new page ("returned in the usage object of every response"); its own Python sample would raise on such
a response. *Fix:* one usage schema for every model and both modes, `cached_tokens` included; document or drop the
`prompt_cache_*` and `created_cache_tokens` fields.

## Token Factory: rate limits

**42. The token counter in the rate-limit headers isn't tokens, and the documented over-limit behavior didn't
happen** (extends #23).
- Ultra sent no `x-ratelimit-*` headers on 71 calls from 2026-10-02 to 10-08, then 300 requests / 200,000 tokens on
  271 calls from 10-17 to 10-24, on an unchanged `system_fingerprint`. (The catalog now matches the headers, so #25's
  sentinel is gone for Nemotron.)
- On all 119 calls where it can be isolated, limit minus remaining tokens equals `floor(message characters / 4) + 512
  × n` (±1). It ignores real prompt tokens, `max_tokens` (up to 512,000), the schema and all output: identical messages
  count 7,683 on Ultra and on Super VL, where usage reports 9,642 and 9,634 prompt tokens.
- The rate-limits page says exceeding the limit returns 429, or serves the request flagged `x-ratelimit-over-limit:
  yes`. On 2026-10-24 opencode sent Ultra 0.74M–1.84M prompt tokens a minute for 9 minutes (170 calls, about three
  times the limit even by the header's own count). Remaining tokens fell to 554 and the dynamic usage header rose from
  19% to 77%, but every call returned 200 without the flag. One burst, so this may be policy rather than a defect.

A client pacing on these headers would treat a 64k-output `n=3` call as about 8k tokens. *Fix:* document what the
counter counts and when; enforce or flag as documented; note header changes in a changelog.

## Token Factory: response shapes and the OpenAPI spec

**43. Undocumented vLLM fields, and the build in `system_fingerprint`.** Non-streamed responses carry vLLM-internal
fields, all null (`prompt_logprobs`, `prompt_token_ids`, `kv_transfer_params`, `moderation`, and per model
`prompt_text`, `metrics`, `ec_transfer_params`; per choice `token_ids`, `stop_reason`, `routed_experts`).
`system_fingerprint` reads `vllm-0.1.dev1+g93e2486b7-tp8-…` on Ultra, `…g5001743e3-dp2-…` on Super and
`…g1bed5fc81-tp2-…` on Super VL (null on Lightning): a dev build's git hash and its parallel layout. Super and
Lightning also duplicate the whole reasoning into `message.reasoning` next to `reasoning_content` (64 of 64 and 6 of
6 messages); Ultra and Super VL don't. Low impact, but three builds plausibly explain the per-model differences in
#21, #27 and #41. *Fix:* strip internal fields and document one response shape.

**44. Spec gaps.** `ChatCompletionChunk.system_fingerprint` refers to "the `seed` request parameter", which the chat
request schema doesn't define; `n`, which works (#20), is missing from it too; and the non-streamed response schema
has no `system_fingerprint`, though the server returns one. *Fix:* define `seed` and `n`, or drop the reference.

**45. Lightning reported identical usage for two different answers** (one observation, never reproduced). The same
50-token prompt with `reasoning_effort` low and high returned identical usage (1,148 completion, 1,143 reasoning
tokens) with reasoning texts of 2,288 and 2,496 characters; three other samples of that prompt ran at 2.00–2.09
characters per reasoning token. *Ask:* check that `reasoning_tokens` counts the returned reasoning on every effort
path.

## Token Factory: catalog and model ids

**46. The catalog's tokens/s figures don't say what they measure.** The catalog gives Ultra 523, Super 127, Lightning
314 and Super VL 282. End to end, on calls with at least 2,000 output tokens: single-choice Ultra calls ran at a median
of 260 tokens/s (35 calls, 137–449), Super VL at 370 (22 calls); `n=3` calls at 537 (Ultra) and 697 (Super VL) in
aggregate, about 180 and 232 per choice. Planned on the catalog figure, a single Ultra call takes about twice as long.
*Fix:* say how the figure is measured (output length, `n`, percentile).

**47. Model ids follow five styles** (extends #6). Today's `/v1/models` lists `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`,
`nvidia/nemotron-3-super-120b-a12b`, `nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/Nemotron-3_5-Lightning` and
`nvidia/Nemotron-3.5-Super-VL`: version 3.5 is written two ways, and Lightning's display name
(`Nemotron-3.5-Lightning`) isn't its id. Ids are case-sensitive (#29). The cookbook's Nemotron index (last changed
2026-09-08) doesn't list Super VL, in the catalog since 2026-10-12, and its Nano note links a Hugging Face URL that returns 401.
*Fix:* one convention, plus case- and separator-insensitive aliases.

**48. Catalog metadata** (extends #7). Super VL is the only entry without a `huggingface_url`, though its repository
has been on Hugging Face since 2026-10-12. License names aren't normalized (`openmdw-1.1`, `OpenMDW v1.1`,
`OpenMDW-1.1`; `MIT License`, `MIT`, `mit`). `created_at` is an integer in 18 entries and an ISO string in 12.
Lightning's date is 2026-08-11 in the catalog and 2026-08-27 in `/v1/models`.

**49. Structured output is under-reported on every Nemotron model, the newest included** (extends #1, #18). Strict
`json_schema` held on every Nemotron model we used (#60), Super VL included, yet `/v1/models` lists only `tools` and
`reasoning` for all five Nemotron ids, and the "JSON mode" tag is on 8 catalog entries, none of them Nemotron, while
the cookbook says Super supports structured output. *Fix:* add `structured_outputs` to their entries.

## Token Factory: docs

**50. Code samples name twelve models that aren't served** (extends #8). Of the model ids in the docs' code samples,
only `openai/gpt-oss-120b`, `Qwen/Qwen3-30B-A3B-Instruct-2507` and `zai-org/GLM-5.2` are in today's listing. New since
#8: `meta-llama/Meta-Llama-3.1-70B-Instruct` (13 times, on the API introduction, text generation, code autocomplete,
vision and the list of models), `deepseek-ai/DeepSeek-R1-0528` (the Quickstart), `BAAI/bge-en-icl`,
`stability-ai/sdxl`, `Qwen/Qwen2-VL-72B-Instruct`, `black-forest-labs/flux-schnell`,
`meta-llama/Meta-Llama-3.1-8B-Instruct` and `meta-llama/Meta-Llama-3-70B-Instruct-cheap`. No code sample uses a
Nemotron model, and the image-generation page has no image model in the catalog. *Fix:* samples on served models,
checked in CI against `/v1/models`; one Nemotron sample with reasoning controls and strict `json_schema`.

**51. Three statements on data retention disagree** (extends #14). The legal quick guide says that without ZDR, API
inputs and outputs "may be stored and used for Speculative Decoding – and for no other purpose", with no retention
period and no mention of Data Lab. Data Lab's pages say API chat completions are "automatically collected" unless ZDR
is on, and raw completions not exported to a dataset are "deleted automatically after 1 year". The `store` field
("for use in our model distillation", #14) is documented only in the OpenAPI spec, and no page says whether
`store: false`, which we send on every request, affects either. *Fix:* one retention statement covering all three.

## Nemotron models (for NVIDIA)

**52. Super VL with thinking on needs room, and nothing bounds it.** On our planner task with its default thinking,
11 of 12 edit choices hit a 64k cap (99.6% of their output was reasoning); the three hoppscotch runs fell back to the
deterministic draft. `low_effort` used 163,855 reasoning tokens over 3 choices, one still cut off, and its critic
reasoned all 32,000 of its tokens. Streamed with 256k, 37 of 45 edit choices finished after a median of ~118k tokens
(8 hit the cap); the experiment took 3 h 31 min and $6.42, 2.5 times Ultra's cost and 6.4 times its time per plan. We
didn't try `medium_effort` or a reasoning budget, because no page says Super VL honors either. *Ask:* document the
effort levels and any budget control Super VL honors, its expected reasoning lengths, and recommended `max_tokens`
and streaming for thinking-on use. (#66: with that room, it plans better.)

**53. Degenerate loops run to the cap and are billed in full.** Ultra (`medium_effort`) looped in 4 of its 92
recorded planner choices, all to `length`: two whitespace runs inside strict JSON (#32), one repeated module list, and
one string that became ``}]})))))```jsonc`` followed by `<|message|>` 6,193 times (that `n=3` call cost $0.42).
Super VL (thinking on) looped in 2 of the 64 choices of its 256k and 512k runs; one spent all 512,000 tokens
reasoning ("Let me pick. Let me go. Let me write."), $0.46 of its run's $0.60. We never tried repetition penalties;
the catalog lists them for Ultra, Super and Lightning, and no sampling parameters at all for Super VL. *Ask:* NVIDIA's
recommended penalties for reasoning plus structured output; Token Factory's supported sampling parameters for Super
VL, and an optional early stop for detected loops.

**54. Ultra in a generic coding agent, at the agent's defaults, loops on one tool call.** Under opencode 1.18.34 (no
temperature, no effort control, `max_tokens` 32,000; 2026-10-24, immich), Ultra's single-shot run made 48 tool calls,
38 of them `ls -la` on the same two folders, the last 24 strictly alternating; 33 responses carried the same reasoning
sentence byte for byte, and reasoning shrank to a median of 16 tokens a step. It stopped at our $2 cap with nothing
changed. Its persistent run moved 374 files and rewrote no import. Super, with the same harness, prompt and history
(opencode sends earlier reasoning back), made 49 tool calls, 38 of them distinct, never the same call twice in a row.
*Ask:* evaluate Ultra in common agent harnesses at their default settings, and publish effort and sampling guidance for
agent use (an agent can't reach `medium_effort` through `reasoning_effort`, #19).

**55. Super's greedy default reaches users through agents** (extends #20). opencode sends no temperature on its agent
calls (249 of 251 on immich), so every Super call ran on Token Factory's default. In one run the automated "continue"
replies got the same refusal 16 times (9 byte-identical) although each turn's context differed. Two byte-identical
first requests still diverged, so the default isn't reproducible either. *Fix:* #20's: default to the model card's
sampling, or document per-model defaults.

**56. Long id lists come back incomplete.** Asked under strict `json_schema` to place every file id (G1, 2026-10-02),
Super and Ultra dropped and duplicated ids on larger inputs: on hoppscotch (189 ids) Super missed 15% with 113
duplicate entries and Ultra 10% with 172; on kaneo (456) Super missed 27% and 45% in two samples, Ultra 39%; on immich
Ultra listed 509 entries for 250 distinct ids. A follow-up round fixed Ultra. With a keyed object that requires one key
per group, every one of 18 Ultra choices returned all 81 of immich's groups, where an array had let one of three drop
26. *Ask:* report coverage fidelity on long lists; Token Factory's structured-output guide could recommend keyed
objects with required keys for "cover every item" tasks.

**57. Ultra named files by the prompt's id column** (weak; our prompt invites it). Our plan-edit prompt lists each
file as "id path ..." and asks for "the file's path exactly as FILES lists it". Ultra named 680 of 1,591 moves (43%)
by the numeric id, in 10 of its 63 finished choices, so our validator dropped those moves. The id column comes first
and our schema's property names are draft keys, so we changed our parser rather than blame the model.

**58. Super VL's long reasoning recalls public repositories.** In 11 of 30 calls its reasoning names the benchmark
project (our scrambles leave names in identifiers) and tries to recall the upstream layout, sometimes wrongly. Its
gains don't track the recall (its largest leads are where it never names the project), so this is a contamination
risk to disclose when benchmarking it on public code, not a measured inflation.

**59. Lightning's batched narration shifts ids.** Narrating 40 findings in 2 calls of 20 (thinking off, strict
schema), it returned 39 narrations: under one finding's id it wrote the next finding's narration and skipped that one;
a strict schema can't enforce one entry per id. 1 of the 39 claims something its evidence doesn't support. *Ask:*
faithfulness and id-alignment evaluations for batched, grounded paraphrase.

## What worked, and should stay

**60. Strict `json_schema` at production scale** (extends #18). Every one of 214 finished choices in our recordings
(2026-10-07 to 10-21) validates against the strict schema its request sent: Ultra 90, Super VL 122 (thinking on, off
and `low_effort`), Lightning 2. The schemas are generated per repository, up to 114 required keys. It let us make a
failure impossible by construction (#56), and the planner has no repair loop.

**61. The bill matches usage, and `n>1` bills the prompt once.** On 2026-10-14 the console showed $9.31 against
$9.259 in our ledger, which is built only from response usage and catalog prices (Ultra 0.65M/0.66M tokens, $2.62,
against 0.649M/0.656M, $2.618); the gap was the one call in #36. Nine `n=3` Ultra calls billed their 156,442 prompt
tokens once, so three candidate plans cost one prompt. That made client-side hard caps exact. *Ask:* say both on the
pricing page.

**62. Reliable, and streaming holds for very long answers.** 857 chat completions over 22 days, never a 429. Of the
five that didn't return 200, two were deliberate 404s, one a deliberate 400, one our client's timeout (#36), and one
the 600 s limit (#30). All 32 streamed calls ended with `[DONE]` and usage, the largest carrying 629,867 completion
tokens over 17.7 minutes, the longest running 19.6 minutes.

**63. Tool calls are well formed.** Through opencode's OpenAI-compatible client, 501 of 501 tool calls from Super and
Ultra parsed, with no repair and no raw markup in text.

**64. Implicit prefix caching, and the new discount.** It needed no opt-in: 49.7% of Ultra's planner prompt tokens and
90% of an agent loop's were cache hits. At the new cached price, that agent loop's input bill falls by about four
fifths: a real win for anyone building coding agents on Token Factory.

**65. Ultra at `medium_effort` is a bounded, cheap planner.** 88 of its 92 planner choices finished under fixed caps
(64k for an edit, 32k for a critique); finished edits peaked near 25k tokens, and all 4 cap hits were loops (#53).
A planner run (three candidates and a critique) averaged $0.17.

**66. With room to think, Super VL plans better** (preliminary). Thinking on, with 256k tokens per answer, it beat
Ultra at `medium_effort` on all four of our scramble benchmarks (hoppscotch 91.26 against 83.22 MoJoFM) at 2.5 times
the cost and 6.4 times the time, and showed no difference on immich. Three runs per entry.

## Nebius AI Cloud

We didn't use it. `ac`'s work is CPU work on the target's own toolchain, and it ran on our own machine. Serverless Jobs
would have fit the long reproductions, but they are billed per second on top of Token Factory with no free tier, and
it was unclear whether the hackathon credits covered them. One naming gap remains (#16): the rules say "DevPods", the
AI Cloud docs say "Devlabs".

## Our earlier log (items 1–29), re-checked on 2026-10-24

| Item | Today |
|---|---|
| 1 | Still true: no Nemotron model carries the JSON-mode tag (Super VL included); the cookbook still says Super supports structured output. |
| 2, 3 | Still true in OpenAPI version 20261022-1d60f32ca. |
| 4 | Still true: no page mentions `chat_template_kwargs`, `enable_thinking`, `low_effort` or `medium_effort`. |
| 5 | Still true: the batch page linked from the cookbook returns 404, and the OpenAPI has no `/v1/batches`. |
| 6, 7 | Still true, and extended by #47 and #48. |
| 8 | Still true, and the list is longer (#50). |
| 9–12 | Still true; the August deprecation notice is still in the future tense, 54 days after the removal. |
| 13 | **Fixed:** caching is documented and priced (#37 for how). |
| 14, 15 | Still true. |
| 16, 17 | Still true. |
| 18–22, 24 | Not re-checked: each needs a paid call, and our budget is frozen. #21 is confirmed at production scale (#33). |
| 23 | **Changed:** the dynamic headers are documented after all (our log was wrong), and Ultra now sends rate-limit headers (#42). |
| 25 | **Fixed for Nemotron:** Super and Ultra list 200,000 TPM / 300 RPM; the sentinel remains on 1 of 30 models. |
| 26 | Still true: 9 of 30 models report the time of the request as `created`. |
| 27 | **Partly fixed:** cached prices exist; the extra usage fields are still undocumented, and Ultra does report hits (#39, #41). |
| 28 | **Corrected:** `/v1/files` is documented; only `/v1/batches` is missing. |
| 29 | Not re-checked (needs a chat request). |

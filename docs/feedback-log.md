# Token Factory / NVIDIA feedback log

A running log for the required "feedback on the tools" submission field, which is also the input for the Most Valuable Feedback bonus. Each entry records what we hit, where, and what would fix it. Evidence lives in [research/02-token-factory.md](research/02-token-factory.md) unless noted.

## Docs and catalog (found during planning research, 2026-10-01)

1. **Structured output on Nemotron is unclear.**
   - The JSON docs say to look for the "JSON mode" tag on a model card. No Nemotron model has that tag.
   - The Nebius cookbook says Super and Nano support structured output.
   - Fix: tag the models, or state that they're unsupported.
2. **The `response_format` reference contradicts itself.** Its description says only `json_object`/`text` are supported, while the enum includes `json_schema`.
3. **The reasoning fields are missing from the non-stream response schema.** `reasoning_content`/`reasoning` appear on stream deltas and on request messages, but not on `ChatCompletionResponseMessage`.
4. **Reasoning controls aren't documented.**
   - Nothing says whether `chat_template_kwargs` (`enable_thinking`, `low_effort`, `medium_effort`) is passed through.
   - Nothing says how the top-level `reasoning_effort` enum maps onto Nemotron's on/off and effort flags.
5. **The batch docs page returns 404.** The cookbook links to it. The public OpenAPI has no `/v1/batches`, only Data Lab `batch_inference` operations. The batch discount and Nemotron eligibility are undocumented.
6. **Model-ID casing is inconsistent:** `nvidia/nemotron-3-super-120b-a12b` (lowercase), `nvidia/Nemotron-3-Ultra-550b-a55b` (mixed case), `nvidia/Nemotron-3_5-Lightning` (underscore). The cookbook also gives a different Nano ID and region than the catalog.
7. **Catalog metadata errors:**
   - Nano's `created_at` is a placeholder (2025-02-01).
   - Super's `huggingface_url` returns 401.
   - Super's `policy_url` points to the Llama 3.1 acceptable-use policy.
   - Ultra's license is "nvidia-open-model-license" in the cookbook but "openmdw-1.1" in the catalog.
8. **Examples reference removed models** (`moonshotai/Kimi-K2.5`, `Meta-Llama-3.1-8B-Instruct-fast`, `Qwen/Qwen3-235B-A22B`, `mistralai/Mistral-Nemo-Instruct-2407`).
9. **The json.md examples are broken:** the Python sample is missing commas, and the curl sample uses `"response format"` (with a space) as a key.
10. **The docs read `message.refusal`,** which isn't in the response schema.
11. **The flavors doc still describes Base vs Fast,** with a `-fast` model-ID suffix. The catalog no longer offers any `-fast` flavor.
12. **The August deprecation notice is still worded in the future tense** after the removal date, and deprecation notices carry no publish dates.
13. **Prompt caching isn't priced.** `usage.prompt_tokens_details.cached_tokens` exists, but no cached-input price or discount is documented. The ideas-board request has been "In Review" for about 7 months. *(2026-10-24: fixed. Cached input is priced since a date between 2026-10-16 and 10-23, and a Cached Tokens page, absent on 2026-10-04, documents it; see feedback.md #37.)*
14. **The `store` field's description mentions "model distillation"**, while the legal guide says content is "not used to train any models". This needs one consistent statement.
15. **The `service_tier` enum has an undocumented `no-limit` value.**

## Hackathon materials

16. **The rules say "DevPods"; the AI Cloud docs say "Devlabs".**
17. **The Builders Program page gives two different Toloka amounts** ($100 in one place, $50 Toloka + $50 Tandem in another, spelled "Tendem" elsewhere).

## Usage

Added during the gate session and the build, as we hit things.

### Gate-session probes (2026-10-02; evidence in [gates/tf-probes.md](gates/tf-probes.md))

18. **The catalog under-reports Nemotron structured output.** `supported_features` lists only `tools, reasoning` for Super, Ultra and Lightning, but strict `response_format: json_schema` is enforced on all three, with thinking on and off. Fix: add `json_mode`/`structured_outputs` to their catalog entries.
19. **`reasoning_effort` maps inconsistently onto Nemotron.**
    - `none` turns thinking off on all three models.
    - On Super, `minimal`/`low` map to `low_effort`, and `medium`…`max` do nothing.
    - On Ultra, every value except `none` is ignored. Nothing maps to `medium_effort`.
    - Meanwhile `chat_template_kwargs` works on all three, both at top level and inside `extra_body`, though no page documents that.
    - Fix: document the mapping, or map `medium` to Ultra's `medium_effort`.
20. **Super defaults to greedy decoding.** Without a `temperature`, `n=3` returns `400 "n must be 1 when using greedy sampling"`, while Ultra and Lightning sample by default. The research notes say TF defaults temperature to 1, and NVIDIA recommends 1.0/0.95. Fix: default to the card's sampling, or document a per-model default.
21. **Truncated reasoning leaks into `content` on Ultra and Lightning.** With `finish_reason: length` while thinking, `reasoning_content` is null and the raw chain of thought sits in `content`. Super handles the same case correctly (`content` null). Fix: use the same reasoning parser for all models.
22. **Lightning with `tool_choice: "required"` loops.** It emitted 30 identical `submit_plan` calls until `max_tokens`, leaving a raw `<tool_call><function=…` fragment in `content`. Super and Ultra return a single call.
23. **Rate-limit headers are model-dependent and partly undocumented.** *(2026-10-24: the dynamic headers are documented after all, so that clause was wrong; Ultra has sent them on every call since 2026-10-17 (none through 10-08); see feedback.md #42.)*
    - Super and Ultra return no `x-ratelimit-*` headers; their catalog limits are a sentinel (item 25).
    - Lightning returns `x-ratelimit-{limit,remaining,reset}-{requests,tokens}` plus `x-ratelimit-dynamic-*` headers that the docs don't describe.
    - `x-ratelimit-over-limit`, which the docs say marks over-quota serving, never appeared in 85 chat calls.
24. **`service_tier` is always null.** The response schema marks it required and the docs use it to detect over-limit serving. It came back null in every non-stream response and was absent from stream chunks, including on a `service_tier: "flex"` request.
25. **`per_request_limits` uses a sentinel.** Super, Ultra and 12 other models (14 of 25) report `10000000000` TPM/RPM, which reads as "unlimited" or "unknown" rather than a real limit. *(2026-10-24: fixed for Nemotron: Super and Ultra list 200,000 TPM / 300 RPM; the sentinel remains on 1 of 30 models.)*
26. **Placeholder `created` timestamps.** In `GET /v1/models?verbose=true`, Nano and eight other models report a `created` value seconds before the fetch, i.e. the time of the request rather than a release date. This is the API listing; item 7's 2025-02-01 placeholder is in the public catalog JSON.
27. **Undocumented caching fields, with a different usage shape per model.** *(2026-10-24: pricing fixed; 'always 0' held only for the short probes, Ultra reports real hits; see feedback.md #39 and #41.)*
    - Usage includes `prompt_cache_hit_tokens` (always 0 for us) and `prompt_cache_miss_tokens` (always equal to `prompt_tokens`).
    - `prompt_tokens_details.created_cache_tokens` appears on Super only. Ultra's `prompt_tokens_details` lacks it, and Lightning's is null.
    - Meanwhile `input_cache_read` pricing is `null` everywhere. The fields suggest a cache exists, but nothing says whether or how it's billed.
28. **`/v1/batches` and `/v1/files` exist,** returning 200 with an empty list, yet the public OpenAPI and the batch docs page (404) don't describe them. *(2026-10-24: correction: `/v1/files` is documented; only `/v1/batches` is missing.)*
29. **Model IDs are case-sensitive.** `nvidia/nemotron-3-ultra-550b-a55b` returns 404 "does not exist". Combined with the mixed casing of the canonical IDs (item 6), this is an easy trap. Fix: case-insensitive matching, or one consistent casing.

## S10 (2026-10-24): the usage findings and the re-check

Written up, with the evidence and the fix for each, in [feedback.md](feedback.md), the submission's feedback field.
Every item below was checked again by an agent told to refute it; the corrected wording is what feedback.md says.
Items 1–17, 23 and 25–28 were re-read against the docs, the catalog and `/v1/models` on 2026-10-24; 29 needs a chat request and wasn't (the table at the end of feedback.md).

30. Non-streamed requests are cut at 600 s: an nginx HTML 504, no request id, billing unknown.
31. Nemotron 3 Super clamps output at 32,768 tokens even at `max_tokens` 64,000, with `finish_reason: length` (2026-10-02).
32. Strict `json_schema` allows unbounded whitespace: three choices ran to `max_tokens` on it.
33. Ultra's truncated reasoning leaks into `content` in production calls (extends 21); usage counts it as reasoning.
34. `guided_json` is accepted and ignored, yet the API reference's "all supported fields" example sends it.
35. `GET /v1/models/{id}` returned 404 for Ultra's exact id, and every catalog id contains a slash.
36. A cut or disconnected call's billing is undocumented, and we found no API that returns a request's usage afterwards.
37. Cached-input prices appeared mid-hackathon with no effective date (extends 13).
38. The serverless prompt cache is shared across organizations, so `cached_tokens` would report cross-tenant hits (from the page's statements; not probed).
39. The cache block size is undocumented (Ultra 4,352 tokens, Super VL 2,176), and Super never hit (2026-10-02).
40. The Cached Tokens page contradicts itself on cache keys; `prompt_cache_key` carries OpenAI's description.
41. Usage differs per model and per stream mode; Lightning's null details contradict the new page (extends 27).
42. The rate-limit token counter is `floor(characters / 4) + 512 × n`; the documented over-limit behavior didn't
    happen at about three times the limit (extends 23).
43. Undocumented vLLM fields; `system_fingerprint` exposes the build; reasoning duplicated in `message.reasoning`.
44. The spec refers to `seed`, which it doesn't define, and omits `n`.
45. Lightning reported identical usage for two different reasoning texts (one observation).
46. The catalog's tokens/s figures don't say what they measure.
47. Model ids follow five styles; version 3.5 is written two ways (extends 6).
48. Catalog metadata: Super VL has no Hugging Face URL; license names and date types aren't normalized (extends 7).
49. Structured output is under-reported on every Nemotron model, Super VL included (extends 1, 18).
50. The docs' code samples name twelve models that aren't served, the Quickstart's among them (extends 8).
51. The legal guide, Data Lab and `store` disagree on data retention (extends 14).
52. Super VL with thinking on needs a median of ~118k tokens per answer, with no documented budget (model).
53. Degenerate loops run to the cap and are billed in full (model, and 32).
54. Ultra in a generic agent at its defaults loops on one tool call (model).
55. Super's greedy default reaches users through agents (extends 20).
56. Long id lists come back incomplete under strict schemas; keyed objects with required keys fix it (model).
57. Ultra named files by the prompt's id column; ours (the prompt lists the id first), so not in feedback.md.
58. Super VL's long reasoning recalls public repositories (a contamination risk to disclose).
59. Lightning's batched narration shifts ids.
60. Positive: strict `json_schema` held on 214 of 214 finished choices.
61. Positive: the bill matches usage, and `n>1` bills the prompt once.
62. Positive: 857 calls with no 429; 32 of 32 long streams complete.
63. Positive: 501 of 501 tool calls well formed.
64. Positive: implicit prefix caching, and the new cached price.
65. Positive: Ultra at `medium_effort` is bounded and cheap.
66. Positive (preliminary): with room to think, Super VL plans better on our scrambles.

Not an item: a "billed in transit" candidate turned out to be our own client's 300 s timeout (part of 36's context).

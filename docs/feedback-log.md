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
13. **Prompt caching isn't priced.** `usage.prompt_tokens_details.cached_tokens` exists, but no cached-input price or discount is documented. The ideas-board request has been "In Review" for about 7 months.
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
21. **Truncated reasoning leaks into `content` on Ultra and Lightning.** With `finish_reason: length` while thinking, `reasoning_content` is null and the raw chain of thought sits in `content`. Super handles the same case correctly (`content: ""`). Fix: use the same reasoning parser for all models.
22. **Lightning with `tool_choice: "required"` loops.** It emitted 30 identical `submit_plan` calls until `max_tokens`, leaving a raw `<tool_call><function=…` fragment in `content`. Super and Ultra return a single call.
23. **No `x-ratelimit-*` headers are sent.** The rate-limit docs describe `x-ratelimit-{limit,remaining,reset}-*` and `x-ratelimit-over-limit`, but none of 85 chat calls carried any of them; only `x-request-id` came back.
24. **`service_tier` is missing from responses.** The response schema marks it required and the docs use it to detect over-limit serving; none of our calls returned it, including `service_tier: "flex"` requests.
25. **`per_request_limits` uses a sentinel.** Super, Ultra and about ten other models report `10000000000` TPM/RPM, which reads as "unlimited" or "unknown" rather than a real limit.
26. **Placeholder `created` timestamps.** In `GET /v1/models?verbose=true`, Nano and ten other models report `created` equal to the request time (it changes on every call).
27. **Undocumented caching fields.** Usage includes `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens` and `prompt_tokens_details.created_cache_tokens`, while `input_cache_read` pricing is `null` everywhere. The fields suggest a cache exists, but nothing says whether or how it's billed.
28. **`/v1/batches` and `/v1/files` exist,** returning 200 with an empty list, yet the public OpenAPI and the batch docs page (404) don't describe them.
29. **Model IDs are case-sensitive.** `nvidia/nemotron-3-ultra-550b-a55b` returns 404 "does not exist". Combined with the mixed casing of the canonical IDs (item 6), this is an easy trap. Fix: case-insensitive matching, or one consistent casing.

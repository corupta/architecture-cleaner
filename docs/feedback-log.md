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

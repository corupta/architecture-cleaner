# Token Factory probes (gate session step 0, 2026-10-02)

These probes close the Token Factory items in plan §12. There were 85 chat calls and 9 free GETs through the recording gateway (`spike/llm/gateway.mjs`, run `tf-probes`), costing **$0.025** against a $0.25 cap. The raw results are outside the tree: `~/ac-work/tf-probes/{lightning,super,ultra,followup}.jsonl`, with cassettes in `~/ac-work/cassettes/tf-probes.jsonl`. Every probe ran once (n=1), so "same/different" claims about sampling rest on a few calls each.

## What the free verbose catalog says (`GET /v1/models?verbose=true`)

| Model | ID (exact; **case-sensitive**: lowercase → 404 "does not exist") | `supported_features` | `per_request_limits` TPM / RPM | Prices returned |
|---|---|---|---|---|
| Super | `nvidia/nemotron-3-super-120b-a12b` | tools, reasoning | 10,000,000,000 / 10,000,000,000 (sentinel) | 0.30 / 0.90, matches pin |
| Ultra | `nvidia/Nemotron-3-Ultra-550b-a55b` | tools, reasoning | 10,000,000,000 / 10,000,000,000 (sentinel) | 1.00 / 3.00, matches pin |
| Lightning | `nvidia/Nemotron-3_5-Lightning` | tools, reasoning | 400,000 / 600 | 0.06 / 0.24, matches pin |
| Nano | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | tools, reasoning | 800,000 / 100 | 0.06 / 0.24 |

- No Nemotron model lists `json_mode` or `structured_outputs`. Six other models do, e.g. gpt-oss-120b, GLM-5.1 and Qwen3-235B-2507. Yet strict `json_schema` **is enforced** on all three Nemotron models (see below), so the catalog under-reports.
- `input_cache_read` is `null` for every model, so there is still no cache price. Usage nevertheless carries `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens` and `prompt_tokens_details.created_cache_tokens`, all 0 in our calls.
- No `x-ratelimit-*` headers came back on any of the 87 calls; only `x-request-id` did. There's no `Retry-After` data yet, because we never hit a 429.
- `/v1/batches` exists and returns `200 {"data":[]}`, and so does `/v1/files`. The research claimed the OpenAPI has no `/v1/batches`. The batch discount and Nemotron eligibility are still unknown; we didn't create a batch.

## Reasoning controls

| Control | Super | Ultra | Lightning |
|---|---|---|---|
| Default (no flags) | thinking on | thinking on | thinking on |
| `chat_template_kwargs.enable_thinking=false` (top level) | **off** (0 reasoning tokens) | **off** | **off** |
| Same inside a literal `extra_body` field | **off** | **off** | **off** |
| `reasoning_effort: none` | off | off | off |
| `reasoning_effort: minimal / low` | maps to `low_effort` (prompt +7 tokens, output identical to `low_effort=true`) | **ignored** (prompt unchanged) | no visible effect |
| `reasoning_effort: medium / high / xhigh / max` | ignored (= default) | ignored | no visible effect |
| `chat_template_kwargs.low_effort=true` | works (366 vs 612 reasoning tokens on the probe task, still correct) | n/a | n/a |
| `chat_template_kwargs.medium_effort=true` | n/a | works (prompt +7 tokens; 677 vs 1040 reasoning tokens) | n/a |

So `chat_template_kwargs` is passed through, and all three models agree on it. `reasoning_effort` is only a partial alias, so **use `chat_template_kwargs` directly**.

**Where reasoning lands:** in `message.reasoning_content` (non-stream) and `delta.reasoning_content` (stream) on all three models. `message.reasoning` was never present. Usage has `completion_tokens_details.reasoning_tokens`, which is included in `completion_tokens`. With streaming, usage arrives in the last chunk when `stream_options.include_usage` is set; the gateway forces it.

**Truncation behaves differently per model** (`max_tokens=64`, thinking on, `finish_reason: length`):
- Super: reasoning goes to `reasoning_content` and `content` is `""`. This is correct.
- Ultra and Lightning: `reasoning_content` is null and **the raw reasoning lands in `content`**. Ultra's content starts "We need to count integers…", Lightning's "Here's a thinking process:…".
- Client rule: on `finish_reason: length`, never parse `content`. Treat it as a failure and retry with more `max_tokens`.

**Thinking off costs answers.** On the probe question (answer 120), every thinking-off call was wrong: Super said 86, Ultra 115/102/115, Lightning 137/210/151. Every thinking-on call was right. So the planner keeps thinking on, and thinking off is reserved for formatting and narration.

## Sampling: Super is greedy by default

- With no `temperature`, **Super decodes greedily**. `n=3` without a temperature is rejected with `400 "n must be 1 when using greedy sampling"`, and five thinking-on calls with different `reasoning_effort` values that map to the same prompt returned byte-identical reasoning (98 chars) and answers. Plain greedy repeats aren't perfectly stable either: two thinking-off calls diverged after a few words, which fits fp4/batching nondeterminism.
- Ultra and Lightning sample by default; repeated calls differ.
- **Consequence for plan §3.5:** the K=3 candidates must set `temperature: 1.0, top_p: 0.95` explicitly. Otherwise Super's "independent samples" are near-copies.
- **`n>1` bills the input once:**
  - Super `n=3` at T=1.0: `prompt_tokens` 34 (same as n=1), `completion_tokens` 77 for 3 choices.
  - Lightning `n=2`: same pattern.
  - So K candidates should start as **one call with `n=K`**, not K calls. That pays the first turn's input (the ~25k-token facts) once instead of K times, assuming `usage` is what's billed; we'll check the console bill after G1. Later evaluate rounds diverge per candidate and are paid separately.

## Structured output and tools

| Probe | Super | Ultra | Lightning |
|---|---|---|---|
| `response_format: json_schema`, `strict: true`, thinking on | **enforced** (schema keys win over a contradicting prompt) | **enforced** (odd whitespace: `"zebra_count": 4\n  ,\n`) | **enforced** |
| Same, thinking off | enforced | enforced | enforced |
| `response_format: json_object` | valid JSON | valid JSON | valid JSON |
| `guided_json` (top-level extra field) | **ignored** (prompt keys returned) | ignored | ignored |
| Named `tool_choice` + `strict: true`, thinking on/off | 1 call, args parse | 1 call, args parse | 1 call, args parse |
| `tool_choice: "required"` | 1 call | 1 call | **degenerate:** 30 `submit_plan` calls until `max_tokens`, plus a raw `<tool_call><function=…` fragment in `content` |
| "Weather in Oslo and Lima", `tool_choice: auto` | 1 call (Oslo only) | 1 call (Oslo only) | 2 parallel calls |
| `force_nonempty_content: true` with tools | `content: ""` (no visible effect) | `content: ""` | `content: ""` |

**Decision for the gateway contract (S5):**
- Structured output uses `response_format: {type: "json_schema", strict: true}` with thinking on, and zod still validates.
- The planner's `submit_plan` stays a named `tool_choice`. That also works, and it keeps the tool loop uniform.
- Never use `tool_choice: "required"` with Lightning.
- Don't count on parallel tool calls from Super or Ultra.

## Other facts

- `service_tier: "flex"` is accepted, but **no response carries a `service_tier` field**, though the schema marks it required. So over-limit serving can't be detected per response.
- Observed throughput (single calls, thinking on, ~1k output tokens):
  - Super: ~200–235 tok/s (catalog says 127).
  - Ultra: ~340–390 tok/s (catalog says 523).
  - Lightning: ~180–200 tok/s (catalog says 314).
- The lowercase-ID probes cost $0, because TF rejected them with a 404 before any tokens were billed.

## Plan corrections from the probes

1. §3.5 K candidates: the first turn is one call with `n=3` and an explicit `temperature: 1.0, top_p: 0.95`. Without the explicit temperature, Super's candidates are greedy near-copies. With `n=3`, the facts are paid once instead of three times.
2. §3.6 structured output: `json_schema` strict works on Nemotron, so it's primary, not just a probe. The forced named tool stays as the fallback. Remove the "Nemotron lacks JSON" caveat; the catalog tag is wrong, not the capability.
3. §3.6 reasoning: control it via `chat_template_kwargs` (`enable_thinking`, `low_effort` on Super, `medium_effort` on Ultra). `reasoning_effort` is a partial, model-dependent alias, so don't use it. Read only `reasoning_content`. On `finish_reason: length`, never parse `content`.
4. §3.6 rate limits: the gateway can't rely on `x-ratelimit-*` headers (none are sent). Use client-side pacing at the catalog's RPM/TPM (Lightning 600/400k) plus 429 backoff.
5. §12: close `chat_template_kwargs` pass-through (yes), `json_schema` (yes) and per-model limits (catalog values above; Super/Ultra show a sentinel). Batch is reachable at `/v1/batches`, but its discount is still unknown.

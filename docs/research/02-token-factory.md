# Track 2: Token Factory facts

Raw research report (2026-10-01/02), kept verbatim. See README.md for method caveats.


---

# Report

## Track 2: Nebius Token Factory facts (researched 2026-10-01)

Primary sources:
- Nebius public catalog JSON `https://tokenfactory.nebius.com/api/public/models_info` (TF-catalog). It also has a Markdown view at `/model-catalog.md`. This is the authoritative price and context source and supersedes the kickoff's third-party listings.
- TF docs: `https://docs.tokenfactory.nebius.com/llms.txt`.
- NVIDIA Hugging Face model cards (`https://huggingface.co/nvidia/<repo>/raw/main/README.md`).
- Devpost rules, overview and update pages.

Plan mode was active, so nothing was cloned and nothing was written. All data came from `curl` GETs and WebFetch. The web-search budget ran out mid-task.

### 0. Naming and endpoints

| Item | Value | Source |
|---|---|---|
| Rename | Nebius AI Studio became **Nebius Token Factory** on **2025-11-05**. Existing AI Studio users were upgraded automatically. | https://nebius.com/newsroom/nebius-launches-nebius-token-factory-to-deliver-production-ai-inference-at-scale |
| Console | https://tokenfactory.nebius.com (API keys at `/project/api-keys`, rate limits at `/project/rate-limits`) | https://docs.tokenfactory.nebius.com/api-reference/introduction.md |
| Docs | https://docs.tokenfactory.nebius.com (the old `docs.studio.nebius.com` returns 301 to it) | curl |
| API base | `https://api.tokenfactory.nebius.com/v1/`, auth `Authorization: Bearer $NEBIUS_API_KEY` | https://docs.tokenfactory.nebius.com/switch.md |
| Regional bases | `api.tokenfactory.{eu-west1,eu-west2,us-central1,us-north1,me-west1,uk-south1,tf-us1,tf-us2,tf-ca1}.nebius.com/v1/`. The default maps to eu-north1. | `window.__DATA__` in the tokenfactory.nebius.com HTML |
| Regional URL warning | Public endpoints are "Global". A regional `base_url` "can stop working if the endpoint's processing region changes." | https://docs.tokenfactory.nebius.com/public-serverless.md |
| AI Cloud console | https://console.nebius.com. Separate billing from TF. | https://docs.nebius.com/signup-billing/payments/promo-codes.md |

### (a) Nemotron models on Token Factory today

The catalog lists exactly four NVIDIA models. Each has a single flavor labelled `cheap`.

| | Nemotron 3 Nano | Nemotron 3 Super | Nemotron 3 Ultra | Nemotron 3.5 Lightning |
|---|---|---|---|---|
| **Exact TF model ID** | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | `nvidia/nemotron-3-super-120b-a12b` | `nvidia/Nemotron-3-Ultra-550b-a55b` | `nvidia/Nemotron-3_5-Lightning` |
| Shape | 30B total / 3B active, hybrid Mamba-Transformer MoE | 120B / 12B, LatentMoE (Mamba-2, MoE and attention) with MTP | 550B / 55B, LatentMoE with MTP | 30B / 3B, hybrid MoE with MTP |
| NVIDIA release (HF card) | 2025-12-15 | 2026-03-11 | 2026-06-04 | 2026-08-11 |
| TF `created_at` | "2025-02-01". This is a placeholder and wrong. | 2026-03-11, matching the Nebius blog the same day | 2026-06-04 | 2026-08-11 |
| TF quantization | fp8 | fp4 | fp4 | bf16 |
| **TF context (`max_model_len`)** | **262,144** | **262,144** (catalog says "256K") | **1,048,576** | **1,048,576** |
| Native context | up to 1M | up to 1M | up to 1M | up to 1M |
| **$/1M input · output** | **0.06 · 0.24** | **0.30 · 0.90** | **1.00 · 3.00** | **0.06 · 0.24** |
| Catalog tokens/s | 60 | 127 | 523 | 314 |
| TF region | eu-north1 | us-central1 | us-central1 | eu-north1 |
| License (catalog) | nvidia-open-model-license | nvidia-open-model-license (HF card says NVIDIA Nemotron Open Model License) | OpenMDW-1.1 | OpenMDW-1.1 |
| Catalog use_cases | text, reasoning, function_calling, code, context_and_rag, responses_api | same plus dedicated-endpoint, summarization, complex_writing | same as Super | same as Nano; tags "1M context, reasoning, code, function calling, MTP" |
| "JSON mode" tag | **absent** | **absent** | **absent** | **absent** |

**Removed from TF serverless on 2026-08-31:**
- `nvidia/Llama-3_1-Nemotron-Ultra-253B-v1` (replaced by Super)
- `nvidia/Nemotron-3-Nano-Omni` (replaced by Lightning)
- `nvidia/Cosmos3-Super-Reasoner`

Lightning is also the named replacement for Llama-3.3-70B, Hermes-4-70B and Qwen3-32B (https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice.md). There are no Llama-Nemotron models on TF anymore.

**Nano looks at risk of deprecation.** Nebius's own cookbook comments it out under "Models not currently featured" (https://raw.githubusercontent.com/nebius/token-factory-cookbook/main/models/nemotron/README.md).

**Flavors:**
- The docs still describe Base vs Fast, with `-fast` appended to the model ID (https://docs.tokenfactory.nebius.com/ai-models-inference/overview.md).
- The current catalog has no `-fast` flavor for any model, and **no Nemotron `-fast` flavor exists**.
- Many `-fast` IDs were removed on 2026-06-22 (https://docs.tokenfactory.nebius.com/june-2026-deprecation-notice.md).

**Max output:**
- No per-model output cap is documented.
- `max_tokens` defaults to **8192** when omitted.
- Prompt plus `max_tokens` must not exceed the context length.
- `max_completion_tokens` counts reasoning tokens too.
- Source: OpenAPI in https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion.md.
- OpenRouter reports Nebius's Nano endpoint at `max_completion_tokens` 235,929. That is a secondary source: `https://openrouter.ai/api/v1/models/nvidia/nemotron-3-nano-30b-a3b/endpoints`.

#### Benchmarks (NVIDIA model cards)

| Benchmark | Nano | Super | Ultra (BF16 / NVFP4) | Lightning |
|---|---|---|---|---|
| SWE-bench Verified, own card | 38.8 (OpenHands) | **60.47** (OpenHands); 59.20 OpenCode; 53.73 Codex | **70.7 / 69.5** | **51.56** |
| SWE-bench Verified, Lightning card's unified harness | 34.08 | 63.08 | n/a | 51.56 |
| SWE-bench Multilingual | 14.07 (unified) | 45.78 (own) / 49.80 (unified) | 67.7 / 69.1 | 39.33 |
| Terminal-Bench | 8.5 (hard subset); 8.29 (2.1, unified) | 31.00 (Core 2.0); 39.61 (2.1, unified) | 56.4 / 53.9 (2.1) | 24.58 (2.1) |
| Tau-bench | V2 avg 49.0 | V2 avg 61.15 | V3 avg 70.9 / 70.3 | τ³ Banking 9.28 |
| BFCL | v4 **53.8** | not reported | not reported | not reported |
| IFBench (IFEval is reported for none of them) | 71.5 (prompt) | 72.56 (prompt) | 81.7 / 82.3 | 71.88 (loose) |
| RULER | @256k 92.9, @1M 86.3 | @256k 96.30, @1M 91.75 | @1M 94.7 / 94.0 | not reported (AA-LCR 52.00) |

Card sources:
- Nano: https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16
- Super: https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16 (it notes the OpenHands row is SWE-bench Verified)
- Ultra: https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4
- Lightning: https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16

TF serves Ultra in fp4, so the 69.5 NVFP4 figure is the relevant one.

Tech reports:
- arXiv 2512.20848 "Nemotron 3 Nano: Open, Efficient Mixture-of-Experts Hybrid Mamba-Transformer Model for Agentic Reasoning" (2025-12-23)
- arXiv 2512.20856 "NVIDIA Nemotron 3: Efficient and Open Intelligence" (2025-12-24)
- https://research.nvidia.com/labs/nemotron/files/NVIDIA-Nemotron-3-Super-Technical-Report.pdf
- https://research.nvidia.com/labs/nemotron/files/NVIDIA-Nemotron-3-Ultra-Technical-Report.pdf

**Measured agentic cost on TF.** This is Nebius's own cookbook, running the same task through a deepagents filesystem agent (https://dev.nebius.com/cookbook/agent-cost-benchmark):

| Model | Input tokens | Output tokens | Turns | Latency | Cost | Result |
|---|---|---|---|---|---|---|
| Lightning | 30.8K | 1.1K | 8 | 7.1s | $0.0021 | pass |
| Super | 53.6K | 7.1K | 14 | 29.3s | $0.0224 | pass |
| Ultra | 45.1K | 3.0K | 10 | 19.3s | $0.0543 | pass |

Ultra needed the deepagents `NemotronPolicyNudgeMiddleware` disabled, and there is an open bug for it.

#### Reasoning controls

- **On/off:** `chat_template_kwargs: {enable_thinking: true|false}` on all four models, default true.
  - **Super** adds `low_effort: true`.
  - **Ultra** adds `medium_effort: true`.
  - Nano and Lightning are on/off only.
  - Confirmed both from the cards and by grepping each repo's `chat_template.jinja`.
- **`truncate_history_thinking`** defaults to true in all four templates, so reasoning from earlier turns is dropped from history.
- **`/think` and `/no_think` are not recognized** by any Nemotron 3 template. The only matches are `</think>`. `/think` appears only in the cards' budget example prompts.
- **`force_nonempty_content: true`** is recommended "for coding agents" (Super, Ultra, Lightning cards). The Ultra card says it plus `enable_thinking` is required with tools on SGLang. It is **not present in the HF chat_template.jinja files**, so its effect on TF is UNVERIFIED.
- **Reasoning budget:** there is no server-side parameter.
  - NVIDIA's recipe is client-side and takes two calls: a chat call with `max_tokens=budget`, then `/v1/completions` with a raw, locally templated prompt using an HF tokenizer.
  - That is impractical from Node. Use on/off, `low_effort`/`medium_effort`, and `max_tokens` instead.
- **TF API:**
  - The schema has a top-level `reasoning_effort` enum: `none|minimal|low|medium|high|xhigh|max`.
  - The request schema has `additionalProperties: true` plus an `extra_body` field.
  - **Whether TF passes `chat_template_kwargs` through and how it maps `reasoning_effort` to Nemotron is UNVERIFIED.** No Nebius page documents it.
  - Third-party evidence: the API7 AISIX gateway forwards `reasoning_effort` to Nebius (https://docs.api7.ai/ai-gateway/providers/nebius-token-factory).
- **Where reasoning appears:** both `message.reasoning_content` and `message.reasoning` (and the same in stream deltas) are in the TF schema. API7 "normalizes upstream reasoning_content or reasoning", so read both.
- **Billing:** reasoning is "reported as a detail inside output usage and billed at the output rate, so count them once" (Nebius cookbook, measured 2026-08-28, https://dev.nebius.com/cookbook/opencode-nebius-token-factory). The schema has `usage.completion_tokens_details.reasoning_tokens`.
- **Sampling:**
  - Super, Ultra and Lightning: temperature 1.0, top_p 0.95 "across all tasks".
  - Nano: 1.0/1.0 for reasoning, 0.6/0.95 for tool calling.

#### Structured output and tools

- **Docs:** `response_format` `{type:"json_schema"}` or `{type:"json_object"}`; "use the JSON mode tag on a model card to find a model with structured output supported" (https://docs.tokenfactory.nebius.com/ai-models-inference/json.md).
- **Nemotron lacks that tag** in the catalog. gpt-oss-120b, the Qwen3-2507 models and GLM-5.1 have it.
- **The API reference contradicts itself:** the description says "Only {'type':'json_object'} or {'type':'text'} is supported", but the enum includes `json_schema`.
- The text-generation example shows `guided_json` sent via `extra_body` (https://docs.tokenfactory.nebius.com/api-reference/examples/text-generation.md).
- The Nebius cookbook model notes claim Super and Nano "support function calling and structured output".
- OpenRouter's Nebius Nano endpoint advertises `response_format`, `structured_outputs`, `tools` and `tool_choice` (secondary).
- **Verdict: `json_schema` on Nemotron is UNVERIFIED.** Plan a fallback.
- **Tools:** all four list `function_calling`.
  - `tool_choice` schema enum: `none|auto|required|{named}`. The docs list only `auto` and named (https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling.md).
  - **`parallel_tool_calls` is not in the chat-completions schema.** It exists only in the Responses API schema.
  - Templates emit qwen3_coder-style `<tool_call><function=…><parameter=…>` XML, which the server parses into OpenAI `tool_calls`.
- **Responses API** (`/v1/responses`): all four Nemotron models carry `responses_api`.

#### Pricing extras

- **Cached input:** no cached price in the catalog or docs.
  - The `usage.prompt_tokens_details.cached_tokens` field exists, but no discount is documented.
  - The feature request "Support Implicite/Explicite Prompt Caching" is "In Review" with 31 votes, posted about 7 months ago (https://ideas.nebius.com/p/support-impliciteexplicite-prompt-caching).
  - OpenRouter shows Nebius `supports_implicit_caching: false`.
  - Assume every resend is paid in full. Nebius's own OpenCode run used 483K input vs 9.8K output over 21 turns.
- **Batch:** `files.create(purpose="batch")` then `batches.create(endpoint="/v1/chat/completions", completion_window="24h")` (https://raw.githubusercontent.com/nebius/token-factory-cookbook/main/batch.ipynb).
  - That notebook warns "Batch access may require project enablement".
  - The linked batch docs page is **404**. The TF UI still has a `/batch-inference` route.
  - The rate-limit doc says the Batch API "has significantly higher limits".
  - The 50% discount ("50% less than regular requests to base models, flavor-independent, most within 24h, ≤5M requests/≤10 GB") comes only from a search-index snippet of the old AI Studio docs. **The current discount and Nemotron eligibility are UNVERIFIED.**
- **`service_tier: "flex"`** does not consume rate-limit credits and runs at lower priority, but can still 429. No flex discount is documented.
- **`n` ≤ 128.** Whether the input is billed once for `n>1` is UNVERIFIED.
- **`store` field:** "store the output … for use in our model distillation". Set it to false.

#### Rate limits

Source: https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits.md

- Limits are dynamic, with a per-user default cap shown in the console.
- The docs' example baseline is **60 RPM / 400,000 TPM**. Actual per-model defaults are UNVERIFIED.
- Evaluation runs in rolling 15-minute windows:
  - average usage ≥80% raises the next window's limit ×1.2
  - average usage ≤50% lowers it ÷1.5
  - the ceiling is **20× base**, and Enterprise is required beyond that.
- Exceeding the limit returns HTTP 429 with `Retry-After`.
- `x-ratelimit-over-limit: yes` means the request was served over quota at low priority.
- Other headers: `x-ratelimit-{limit,remaining,reset}-{requests,tokens}` and `x-ratelimit-dynamic-*`.

### (b) Kickoff claims, verified

| Kickoff claim | Verified value (source) |
|---|---|
| Submission window 08-26 to 10-30 10:00 PT | VERIFIED: Aug 26 9:00 PT to Oct 30 10:00 PT (rules) |
| Judging Dec 1–15, winners ~2027-01-11 | VERIFIED: Dec 1 9:00 PT to Dec 15 12:00 PT; winners "on or around" Jan 11 2027 12:00 PT (rules) |
| 15.4k registrants | VERIFIED: 15,451–15,452 on 2026-10-01 (overview) |
| Track text | VERIFIED verbatim: "agents that write, run, and test code in Token Factory" |
| Prizes 20k/10k/6k; Jetson per track; Tavily $3k; Feedback $100+swag ×10 | VERIFIED. **Missing from kickoff:** City Winner Awards, $500 ×20, for in-person city events (overview, rules) |
| One Overall OR one Track plus one Bonus | VERIFIED (rules) |
| Stage 1 pass/fail incl. Serverless Jobs/Endpoints/DevPods | VERIFIED. Added rule: "a genuine attempt at the track's stated goal, not a superficial rebrand" (rules) |
| Stage 2: four equal criteria, tie-break order | VERIFIED. Each criterion is scored **1–5** (update 46204) |
| Judges need not run the project | VERIFIED verbatim: "may choose to judge based solely on the text description, images, and video" |
| "Code completion counts as standard"; "autonomously plan, write, test, and refine code with minimal human intervention" | **Paraphrase, not verbatim.** Actual: "a code-completion wrapper is a start; an agent that plans, writes, tests, and iterates on a real repo with minimal human input is where it gets interesting" (https://nebiusglobalaihackathon.devpost.com/updates/46204-here-s-how-judging-works). The kickoff's quote was not found on the overview, rules or updates pages: UNVERIFIED |
| Submission package | VERIFIED, with additions in (c) |
| Multiple submissions allowed | VERIFIED |
| Ultra 550B-A55B, reasoning and tools, 1M, $1.00/$3.00 | VERIFIED (TF-catalog, HF card) |
| Ultra "71.9% SWE-bench Verified" | **WRONG / UNVERIFIED.** Card: 70.7 BF16, 69.5 NVFP4. TF serves fp4. |
| Super 120B-A12B, 262K, $0.30/$0.90 | VERIFIED. TF caps at 262,144; the model natively does 1M. |
| Nano 30B-A3B, context "verify", $0.06/$0.24 | VERIFIED. Context on TF is **262,144** (native 1M). |
| (Not in kickoff) Lightning | Exists: `nvidia/Nemotron-3_5-Lightning`, $0.06/$0.24, 1M on TF, SWE-bench V 51.56 vs Nano 34.08. It dominates Nano for fan-out. |
| $25 via `NEBIUS-DEVPOST-GLOBAL26` plus $25 Builders | Amounts VERIFIED (Resources page, Kickoff Tips update, https://dev.nebius.com/builders). Code terms and expiry UNVERIFIED (the form is JS-rendered). TF requires a bank card at onboarding (VERIFIED). |
| "Prices come from third-party listings" | Now primary: TF-catalog JSON |
| Serverless Jobs for K candidates | Feasible but billed as Compute per second, separate account, no free tier. See (c2). |
| CLAUDE.md: "testable, free of charge, until 2026-12-15" | VERIFIED: "available free of charge and without any restriction … until the Judging Period ends" (rules) |
| OSS license file | VERIFIED; "detectable and visible at the top of the repository page (in the About section)" (rules) |

### (c) Hackathon rules relevant to planning

Sources: https://nebiusglobalaihackathon.devpost.com/rules, `/`, `/updates`, `/resources`

- **Required stack:** "a runtime call to the Token Factory inference API, or deployed/run using Nebius AI Cloud compute (Serverless Jobs, Serverless Endpoints, or DevPods)" plus "at least one NVIDIA open source model".
  - The Kickoff Tips list Nemotron, GR00T, Cosmos and Sonic as qualifying.
  - The criteria text names "NVIDIA Nemotron" explicitly.
- **README** must cover setup and running, and "highlight how you've used NVIDIA Nemotron … and where Token Factory accelerated your workflow and any other Nebius Tools or Services used".
- **Demo:** "a URL to a working demo, hosted application, or test build". Testing access must be "free of charge and without any restriction … until the Judging Period ends". If the site is private, include credentials.
- **Functionality:** "must be capable of being successfully installed and running consistently … and must function as depicted in the video".
- **Video:** under 3 minutes, public on YouTube, showing the project functioning, with no unlicensed music or trademarks.
  - Update 46205: name TF and the NVIDIA model "clearly — with audio — in your demo video", add them to "Built With", and "treat your video like a pitch, not a tutorial".
- **Also required:** text description, track selection, English, feedback on TF, AI Cloud and NVIDIA tools, and a pre-existing-work explanation if any work predates the period.
- **Repo** must hold "all necessary source code, assets, and instructions required for the project to be functional".
- **Judges (23)** include:
  - TF people: Founding PMM, DevRel leads, Head of PM ML/AI, a Serverless AI TPM
  - NVIDIA SWEs
  - Tavily FDEs
- **Track hint (Best Apps text):** "Reach for Nemotron 3 Ultra when you need serious reasoning, and let Nano or Super handle the fast, everyday calls."
- **Credits:**
  - $25 TF code via https://nebius.com/promo-code?utm_promo_event_code=2026-devpost-global-ai-hack&utm_promo_code_type=Token_Factory&utm_promo_activation_code=NEBIUS-DEVPOST-GLOBAL26.
  - Builders Program (free) gives $25 TF, **$25 Tavily**, $100 LangSmith, Toloka credit (the page says $100 in one place and $50 Toloka + $50 Tandem in another), and a $1 certification. It is "primarily intended for learning, testing, and experimentation" and states no expiry.
  - TF billing: bank card mandatory, **$1 trial credit valid 30 days**, promo codes "usually have an expiration date", applied via Top up → With promo code.
  - The card is auto-charged when the balance is negative at the start of the month or a threshold is hit, and a failed charge suspends the account (https://docs.tokenfactory.nebius.com/other-capabilities/billing-new.md).
  - Total usable TF credit is about $51.

#### (c2) Nebius AI Cloud Serverless and TF Sandboxes

- **Serverless AI** (https://docs.nebius.com/serverless/overview.md):
  - Docs call the three types Devlab, Job and Endpoint. The rules say "DevPods".
  - All three run on Compute container VMs with per-second Compute pricing and no own free tier.
  - Adding a card to AI Cloud charges a $25 prepayment (https://docs.nebius.com/signup-billing/payments/promo-codes.md).
  - Whether TF credits apply to AI Cloud is not stated. The hackathon code is labelled Token_Factory, so presume no.
  - Jobs are non-interactive, have no public URL, and cannot be stopped.
  - Endpoints get a managed HTTPS URL with token auth. CPU example: `--platform cpu-d3 --preset 4vcpu-16gb`.
  - cpu-d3 (AMD EPYC Genoa) from 2026-10-01 costs $0.015/vCPU-h plus $0.0045/GiB-h, about $0.13/h. Kept alive Oct 30 → Dec 15 that is **about $146 excluding disk** (my arithmetic from https://docs.nebius.com/compute/resources/pricing.md).
  - Adoption cost: AI Cloud account, project, VM quota, a container image, and `nebius ai create --type job` or REST `POST https://api.nebius.cloud/ai/v1/jobs`.
  - **Verdict:**
    - Not needed for K parallel candidates: the LLM calls are I/O-bound and limited by TF rate limits, and certification is local CPU work.
    - Not affordable as an always-on demo; a static replay on a free host is enough.
    - The only upside is optics.
- **TF Sandboxes (beta), absent from the kickoff and highly relevant** (https://docs.tokenfactory.nebius.com/sandboxes/overview.md, https://docs.tokenfactory.nebius.com/sandboxes/swe-agents.md):
  - VM-isolated code execution with "Git-like branching — fork from any checkpoint, run parallel explorations, and roll back instantly".
  - More than 7,000 preloaded SWE environments (SWE-bench Verified, SWE-rebench, SWE-rebench-V2).
  - Beta limits: 50 concurrent operations, 180-day image retention.
  - Interfaces: Python `contree-sdk`, `contree-cli`, an MCP server, and REST at `https://api.tokenfactory.nebius.com/sandboxes` with `NEBIUS_API_KEY`.
  - **Pricing is undocumented (UNVERIFIED).**
  - It matches the track wording "write, run, and test code in Token Factory" and the K-candidate branch-and-certify idea.

### (d) Gotchas for a Node/TS CLI

1. **Use the openai npm SDK** with `baseURL: "https://api.tokenfactory.nebius.com/v1/"`. Pass non-standard fields (`chat_template_kwargs`, `guided_json`) as extra body keys.
   - The TS types reject them, so cast. At runtime openai-node sends unknown keys as-is; this is standard SDK behaviour, but verify it.
   - TF also accepts a literal `extra_body` field per its schema. Which form TF honours for `chat_template_kwargs` is UNVERIFIED; test both.
2. **Model IDs are case-inconsistent:** lowercase Super, mixed-case Ultra and Nano, an underscore in `Nemotron-3_5-Lightning`. Use the exact catalog strings. Case-insensitivity is UNVERIFIED.
   - The Nebius cookbook gives Nano as `nvidia/nvidia-nemotron-3-nano-30b-a3b` on the us-central1 base, which conflicts with the catalog.
3. **Global vs regional base URL:**
   - The catalog places Super and Ultra in us-central1, and the cookbook model notes recommend `api.tokenfactory.us-central1.nebius.com`.
   - The cookbook notebooks and the cost benchmark use the global base for all three, and the docs warn that regional URLs can break.
   - Default to the global base and verify with `GET /v1/models` at spike time.
4. **Default `max_tokens` is 8192 and reasoning counts against it.** With thinking on, expect `finish_reason:"length"` with empty or null `content`. Always set `max_tokens` (or `max_completion_tokens`) and handle truncation.
5. **Read `message.reasoning_content ?? message.reasoning`.** Neither is typed in the SDK. Do not feed reasoning back into history, since the template truncates it anyway.
6. **Budget from `usage`:** `completion_tokens` already includes reasoning tokens billed at the output rate; `completion_tokens_details.reasoning_tokens` is only a breakdown. When streaming, set `stream_options:{include_usage:true}` and usage arrives only in the last chunk.
7. **There is no caching discount.** Every turn resends the full prompt at full price. Keep prompts compact, prefer single-shot "plan as data" over multi-turn agent loops, and record and replay every call.
8. **Structured output is not officially supported on Nemotron.** Strategy:
   - Try `response_format:{type:"json_schema"}`.
   - Fall back to a single forced tool (`tool_choice:{type:"function",function:{name:"submit_plan"}}`) whose arguments are the plan.
   - Always validate with zod and retry on failure.
   - Interplay between guided decoding and reasoning on TF is UNVERIFIED.
9. **Tool calls are parsed server-side from XML.** If parsing fails, expect raw `<tool_call>` text in `content`, and keep a fallback parser. NVIDIA recommends `force_nonempty_content:true` for coding agents. Parallel tool calls on chat completions are UNVERIFIED.
10. **Handle 429** using `Retry-After`. Log `x-ratelimit-*` and the response's `service_tier` (`over-limit`). `service_tier:"flex"` is an option for background K-candidate calls.
11. **Sampling:** NVIDIA wants temperature 1.0 and top_p 0.95. TF defaults temperature to 1. `seed` is not in the TF request schema, so do not count on determinism; record and replay.
12. **Data retention:**
    - By default TF keeps inputs and outputs (in Finland) for speculative decoding.
    - It also collects chat completions into Data Lab unless **Zero Data Retention** is on. ZDR is an org-level toggle on the account profile and may slow inference.
    - The `store` field exists; set `store:false`.
    - This matters for corupta's private Sequelize repo (https://docs.tokenfactory.nebius.com/legal/legal-quick-guide.md, https://docs.tokenfactory.nebius.com/data-lab/data-processing.md).
13. **Deprecation churn:** Nebius removes serverless models with roughly 1–2 months' notice (June 22 and Aug 31 batches) and does not reroute. The judging window (Dec 1–15) needs a replay mode that works without the live model and without a key. Keep model IDs in config.
14. **Never ship the key:**
    - A judge-facing live mode would spend our credits.
    - The rules demand free, unrestricted access through Dec 15.
    - Billing auto-charges the card once credits run out.
    - A hosted static replay plus a CLI `--replay` test build satisfies the rules without exposing the key.

### Still UNVERIFIED; zero-cost checks for the G1 spike (with key, under $0.05)

- `GET /v1/models` on the global base and on us-central1, to confirm exact IDs and reachability (free).
- One tiny call per model:
  - `chat_template_kwargs.enable_thinking:false` vs default, checking `reasoning_content`/`reasoning`.
  - `reasoning_effort:"none"`, to see whether it maps.
  - `low_effort` on Super and `medium_effort` on Ultra.
- `json_schema` and `json_object` on Super and Lightning; a named `tool_choice`; `tool_choice:"required"`.
- Read the `x-ratelimit-limit-*` headers for each model's baseline.
- Whether `n>1` bills input once.
- Batch availability for Nemotron and its current discount.
- Sandboxes pricing.
- Promo-code expiry. Check the TF console after redeeming.

### Feedback-log material found in passing (for the required feedback field and the Feedback bonus)

1. The catalog `huggingface_url` for Super (`nvidia/Nemotron-3-Super-120B`) returns 401.
2. Nano's `created_at` is the placeholder "2025-02-01".
3. The JSON docs say to look for the "JSON mode" tag, yet Nemotron lacks it while the cookbook claims structured-output support.
4. The `response_format` description in the API reference contradicts its own enum.
5. The batch docs page is 404, yet the cookbook and the rate-limit doc link to it.
6. The switch and function-calling examples use removed models (`moonshotai/Kimi-K2.5`, `Meta-Llama-3.1-8B-Instruct-fast`).
7. Model-ID casing is inconsistent, and the cookbook's Nano ID and region differ from the catalog.
8. The rules say "DevPods"; the AI Cloud docs say "Devlabs".
9. The Builders page gives two different Toloka credit amounts.
10. Ultra's license is "nvidia-open-model-license" in the cookbook note but "openmdw-1.1" in the catalog.


---

# Independent verification

## Track 2 re-verification: Nebius Token Factory (checked 2026-10-01)

Method: read-only GETs and WebFetch. I did not call any paid API and did not clone any repo. The web-search budget ran out early, so every check below comes from fetching primary sources directly. The scratch downloads are in `/tmp/ac-research/{tfdocs,hfcards,aicloud}` and `/tmp/tf-openapi.json`.

Primary sources:
- **TF catalog:** https://tokenfactory.nebius.com/api/public/models_info (25 models)
- **TF OpenAPI:** https://api.tokenfactory.nebius.com/openapi.json, version `20260930-cfb76be12`. This is newer than the docs page's embedded spec (`20260923`).
- **TF docs:** https://docs.tokenfactory.nebius.com/llms.txt and `/llms-full.txt`
- **HF cards and templates:** `https://huggingface.co/nvidia/<repo>/raw/main/{README.md,chat_template.jinja,generation_config.json}`
- **Devpost:** `/rules`, `/`, `/updates/46203`, `/updates/46204`, `/updates/46205`, `/resources`

### (1) Corrected fact table

| | Nano | Super | Ultra | Lightning |
|---|---|---|---|---|
| TF model ID | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | `nvidia/nemotron-3-super-120b-a12b` | `nvidia/Nemotron-3-Ultra-550b-a55b` | `nvidia/Nemotron-3_5-Lightning` |
| Flavor label (the only one) | cheap | cheap | cheap | cheap |
| `max_model_len` on TF | 262,144 | 262,144 (`context_window_k` 256) | 1,048,576 | 1,048,576 |
| $/1M input · output | 0.06 · 0.24 | 0.30 · 0.90 | 1.00 · 3.00 | 0.06 · 0.24 |
| Quantization | fp8 | fp4 | fp4 | bf16 |
| Region | eu-north1 | us-central1 | us-central1 | eu-north1 |
| Catalog tok/s | 60 | 127 | 523 | 314.12 |
| Catalog license | nvidia-open-model-license | nvidia-open-model-license (`policy_url` = Llama 3.1 AUP) | openmdw-1.1 | OpenMDW v1.1 |
| Catalog `created_at` | 2025-02-01 (placeholder) | 1773187200 = 2026-03-11 | 1780531200 = 2026-06-04 | 2026-08-11 |
| HF release date | 2025-12-15 | 2026-03-11 | 2026-06-04 | 2026-08-11 |
| Native context | 1M | 1M | 1M | 1M |
| "JSON mode" tag | no | no | no | no |
| Effort knob (chat_template_kwargs) | on/off only | `low_effort` | `medium_effort` | on/off only |
| What the knob does in the template | — | appends `\n\n{reasoning effort: low}` to the last user message | appends `\n\n{reasoning effort: efficient}` | — |
| Sampling defaults in HF `generation_config` | T 1.0, top_p 1.0 | T 1.0, top_p 0.95 | T 1.0, top_p 0.95 | T 1.0, top_p 0.95 |
| SWE-bench Verified, own card | 38.8 (labelled "SWE-Bench (OpenHands)", "Verified" not stated) | 60.47 (OpenHands) | 70.7 BF16 / **69.5 NVFP4** | 51.56 |
| SWE-bench Verified, Lightning card's unified harness | 34.08 | 63.08 | — | 51.56 |

API-level facts (all from the OpenAPI unless noted):
- `max_tokens` defaults to 8192.
- `max_completion_tokens` includes reasoning tokens.
- `n` is 1–128.
- `reasoning_effort` enum: none, minimal, low, medium, high, xhigh, max.
- `response_format` enum: text, json_object, json_schema. Its description says only json_object and text are supported.
- `tool_choice`: none, auto, required, or named.
- `service_tier` enum: auto, default, over-limit, flex, **no-limit**.
- The chat request has `additionalProperties: true` and a literal `extra_body` field.
- The chat request has **no** `seed`, `parallel_tool_calls` or `chat_template_kwargs`.
- Chat tools **do** have `strict`.

Rate limits: the docs' example baseline is 60 RPM / 400k TPM. The limit scales ×1.2 when a 15-minute window averages ≥80% use, ÷1.5 when it averages ≤50%, and is capped at 20× base. The 429 response carries `Retry-After`.

Billing:
- A bank card is mandatory.
- New accounts get a $1 trial credit valid for 30 days.
- The card is auto-charged when the balance is negative at the start of the month or a threshold is hit. A failed charge suspends the account.

Hackathon credits: $25 from code `NEBIUS-DEVPOST-GLOBAL26` plus $25 from the Builders Program, so about $50 plus the $1 trial.

### (2) Claim-by-claim verdicts

**Section 0: naming and endpoints**
- **Rename on 2025-11-05; existing users "will upgrade automatically": CONFIRMED.** Source: nebius.com newsroom post.
- **Console, `/project/api-keys`, `/project/rate-limits`: CONFIRMED.** Sources: the api-reference introduction and rate-limits docs.
- **`docs.studio.nebius.com` returns 301 to the new docs: CONFIRMED** (curl).
- **API base `https://api.tokenfactory.nebius.com/v1/`, Bearer `NEBIUS_API_KEY`: CONFIRMED** (switch.md).
- **Regional bases: CONFIRMED.** The `codeSampleEndpoints` block in the tokenfactory.nebius.com HTML maps eu-north1 (and "man-ik8s") to the global base. The page config also exposes `sandboxesURL: https://api.tokenfactory.nebius.com/sandboxes/v1/`.
- **Regional URL warning: CONFIRMED.** Source: public-serverless.md. The same text is repeated in legal-quick-guide §5.1.
- **AI Cloud billing is separate: CONFIRMED in substance.** Adding a card to AI Cloud charges $25 (promo-codes doc). No source states whether TF credits cross over.

**Section (a): models**
- **Exactly 4 NVIDIA models, all with a single `cheap` flavor: CONFIRMED.** All 25 catalog models carry only `cheap`, and no `-fast` IDs exist anywhere.
- **Every price, context length, quantization, region, tok/s value, license and use_case in the report: CONFIRMED** against the catalog JSON.
- **"Only gpt-oss-120b, the Qwen3-2507 models and GLM-5.1 have the JSON mode tag": INCOMPLETE.** The full list is DeepSeek-V4-Flash-0731, DeepSeek-V4-Pro, Hermes-4-405B, gpt-oss-120b, MiniCPM-V-4_5, Qwen3-235B-A22B-Instruct-2507, Qwen3-30B-A3B-Instruct-2507 and GLM-5.1.
- **Removals on 2026-08-31 and their replacements: CONFIRMED** (august-2026-deprecation-notice.md). The page is still worded in the future tense.
- **"No reroute": CONFIRMED.**
- **Lightning as the replacement for Llama-3.3-70B, Hermes-4-70B, Qwen3-32B and Nano-Omni: CONFIRMED.**
- **Nano commented out under "Models not currently featured" in the cookbook: CONFIRMED.**
- **Flavors docs (Base/Fast, `-fast` suffix) and the `-fast` removals on 2026-06-22: CONFIRMED.**
- **Max output (8192 default, prompt + max_tokens ≤ context, `max_completion_tokens` includes reasoning): CONFIRMED.**
- **OpenRouter reports 235,929 max completion tokens for the Nebius Nano endpoint: CONFIRMED.** Note that Nebius is the OpenRouter provider only for Nano, not for Super, Ultra or Lightning.
- **Benchmarks: all CONFIRMED,** including the Nano/Super/Ultra/Lightning cells for Terminal-Bench, Tau, BFCL, IFBench, RULER and SWE-bench Multilingual. Caveats:
  - Nano's 38.8 is labelled "SWE-Bench (OpenHands)" on its card, without "Verified".
  - No card reports IFEval as a score; it appears only as training data.
- **Tech reports: CONFIRMED.** The arXiv API gives 2512.20848 published 2025-12-23 and 2512.20856 published 2025-12-24, with the stated titles. Both NVIDIA PDFs return 200.
- **Cookbook cost table (30,825/1,140/8 turns/7.12s/$0.002123, and so on): CONFIRMED.**
  - **WRONG:** "there is an open bug". The page says a bug is open, but langchain-ai/deepagents#5982 (opened 2026-08-29) is now **Closed**.
  - Missed detail: the run used `langchain_nebius.ChatNebius` with `temperature=0` and `max_tokens=16384`, which does not follow NVIDIA's T=1.0 recommendation.
- **Reasoning on/off, `low_effort` on Super, `medium_effort` on Ultra, `truncate_history_thinking` defaulting to true, `/think` and `/no_think` not recognized: CONFIRMED** by grepping the four `chat_template.jinja` files.
- **"Reasoning from earlier turns is dropped": PARTIALLY WRONG.**
  - Only assistant messages before the *last user message* are truncated.
  - For assistant messages after it (the current tool-call loop), the template wraps `message.reasoning_content` in `<think>…</think>` and keeps it.
- **`force_nonempty_content` is not in the templates: CONFIRMED.** Its mechanism, which the report did not have:
  - It is read by NVIDIA's vLLM reasoning-parser plugin (`super_v3_reasoning_parser.py` on the Super HF repo).
  - When `enable_thinking` is false or `force_nonempty_content` is true **and** no `</think>` is found, the parser moves everything into `content`.
  - The plugin's docstring says reasoning that hits max length otherwise yields empty `content`.
  - Whether TF runs this parser is UNVERIFIABLE.
- **The Ultra card's "must set enable_thinking + force_nonempty_content with tools" note sits under SGLang: CONFIRMED.**
- **Reasoning budget is a client-side, two-call recipe: CONFIRMED** (Super card). TF does expose `/v1/completions`.
- **`reasoning_effort` enum: CONFIRMED.** Its mapping to Nemotron and whether TF passes `chat_template_kwargs` through: UNVERIFIABLE.
  - "No Nebius page documents it" is **slightly overstated**. ai-models-inference/overview.md says "API — Supports the full set of vLLM parameters", which is indirect evidence that vLLM-style kwargs reach the engine.
- **API7 AISIX forwards `reasoning_effort` and normalizes `reasoning_content`/`reasoning`: CONFIRMED.** That page also says AISIX does not support batch.
- **"`message.reasoning_content` and `message.reasoning` are in the TF schema": PARTIALLY WRONG.**
  - In both the live OpenAPI and the docs spec, the non-streaming `ChatCompletionResponseMessage` has only `role`, `content` and `tool_calls`.
  - `reasoning_content` and `reasoning` exist on the **request** `ChatCompletionMessage` (so they can be sent back) and on `ChatCompletionStreamResponseDelta`.
  - Whether non-stream responses include them is UNVERIFIED (likely, but undocumented).
- **Reasoning billed at the output rate, "count them once": CONFIRMED.** The measurement was on **GLM-5.2**, not Nemotron (opencode 1.18.21, 2026-08-28: 483,125 input tokens, 9,830 output + 9,576 reasoning, $0.7618). The cost only reconciles if reasoning is billed at the output rate.
- **`usage.completion_tokens_details.reasoning_tokens`: CONFIRMED.**
- **Sampling recommendations: CONFIRMED.** Nano is 1.0/1.0 for reasoning and 0.6/0.95 for tools; the others are 1.0/0.95. The HF `generation_config` defaults match.

**Structured output and tools**
- **Docs text (json_schema/json_object, "JSON mode tag"), the API-reference contradiction, `guided_json` via `extra_body`: CONFIRMED.**
  - The curl example puts `guided_json` top-level.
  - The JS example sends a literal `extra_body` key.
- **The cookbook says Super and Nano "support function calling and structured output": CONFIRMED.**
- **OpenRouter's Nebius Nano endpoint lists `response_format`, `structured_outputs`, `tools` and `tool_choice`: CONFIRMED.** It also lists `seed`, `top_k`, `repetition_penalty` and `logit_bias`.
- **json_schema on Nemotron: UNVERIFIED, as the report says.**
- **`tool_choice` enum, and the docs listing only auto and named: CONFIRMED.**
- **`parallel_tool_calls` exists only in the Responses API schema: CONFIRMED.**
- **qwen3_coder XML format: CONFIRMED** in the templates, and the cards specify `--tool-call-parser qwen3_coder`.
- **`responses_api` use case on all four: CONFIRMED.**

**Pricing extras**
- **No cached price or discount documented, `cached_tokens` field exists: CONFIRMED.**
  - The ideas.nebius.com request is "In Review", has 31 upvoters, is about 7 months old and has no official reply.
  - OpenRouter shows `supports_implicit_caching: false`.
  - The docs do list "Context Caching" as an internal optimization, with no price effect.
- **Batch notebook (`files.create(purpose="batch")`, `batches.create(...,"24h")`, the "may require project enablement" warning): CONFIRMED.**
  - The linked docs page returns 404: CONFIRMED.
  - **Correction:** the rate-limit doc's "Read more" is plain text with no link, so it does not link to the 404 page.
  - `/batch-inference` in the TF UI returns 200. That is weak evidence, because the SPA likely returns 200 for any route.
  - The 50% discount: UNVERIFIABLE. `llms-full.txt` has no discount text.
- **`service_tier: "flex"` semantics: CONFIRMED** from the enum docstring. No flex discount is documented.
- **`n` ≤ 128: CONFIRMED.** Input billing for `n>1`: UNVERIFIABLE.
- **`store` field (distillation wording): CONFIRMED.**

**Rate limits**
- **Every rule, header and the 60 RPM / 400k TPM example: CONFIRMED.** Per-model defaults: UNVERIFIABLE without a key.
- **"Batch API has significantly higher limits": CONFIRMED.**

**Section (b): kickoff claims**
- **Submission window and judging dates: CONFIRMED verbatim.**
- **Registrants: CONFIRMED (~15.4k).** The overview showed 15,456 when I fetched it today.
- **Track text: CONFIRMED.**
- **Prizes: CONFIRMED,** including City Winners at $500 ×20 for "Builders & Brews" in-person events.
- **Award-combination rule: CONFIRMED.**
- **Stage 1, including the "genuine attempt … not a superficial rebrand" rule: CONFIRMED.**
- **Stage 2 scoring 1–5, four equal criteria: CONFIRMED** (update 46204).
- **Judges may score from the description, images and video alone: CONFIRMED verbatim.**
- **The kickoff's "standard" and "autonomously plan, write, test, and refine…" quotes: CONFIRMED absent.** The rules page has none of "autonomously", "standard", "code completion", "minimal human intervention" or "refine". The real quote is in 46204: "a code-completion wrapper is a start; an agent that plans, writes, tests, and iterates on a real repo with minimal human input is where it gets interesting."
- **Ultra 71.9%: WRONG, as the report says.** The kickoff's source (blog.buildfastwithai.com, 2026-06-05) contains no Ultra SWE-bench Verified number. The card gives 70.7 BF16 and 69.5 NVFP4.
- **Super/Nano/Lightning kickoff rows: CONFIRMED.**
- **Credits:** amounts CONFIRMED (Resources page, Kickoff Tips, Builders page). Promo-code expiry: UNVERIFIABLE; the promo page has no terms text.
- **"Free of charge … until the Judging Period ends": CONFIRMED verbatim.**
- **License "detectable and visible at the top of the repository page": CONFIRMED.**

**Section (c): hackathon rules**
- **Required-stack quote, the README Nemotron requirement, the "installed and running consistently … function as depicted in the video" rule, the "all necessary source code, assets, and instructions" rule, English: CONFIRMED.**
- **Update 46205 (audio callouts, Built With, "pitch, not a tutorial", "Hide your API keys"): CONFIRMED.**
- **23 judges: CONFIRMED.** Roles include a Founding PMM for TF, two TF DevRel leads/advisors, the Head of PM ML/AI, a Serverless AI TPM (Mikhail Rozhkov), NVIDIA SWEs and Tavily FDEs.
- **Best Apps track hint: CONFIRMED verbatim.**
- **Builders Program credits: CONFIRMED.**
  - The page lists $25 TF, $25 Tavily, $100 LangSmith and $1 certification.
  - A "$100 Toloka" tile conflicts with the FAQ's "$50 in Toloka and $50 in Tandem". The page also spells it "Tendem" elsewhere.
  - "Primarily intended for learning, testing, and experimentation"; no expiry is stated.
- **TF billing terms: CONFIRMED** (billing-new.md).

**Section (c2): AI Cloud Serverless and Sandboxes**
- **Devlab/Job/Endpoint, Compute billing, no separate quotas or pricing, Jobs with no URL and no stop: CONFIRMED** (serverless/overview, pricing-quotas).
- **The $25 card prepayment: CONFIRMED.**
- **`cpu-d3` = Genoa, and the `--platform cpu-d3 --preset 4vcpu-16gb` example: CONFIRMED.**
- **`nebius ai create --type job` and `POST https://api.nebius.cloud/ai/v1/jobs`: CONFIRMED.**
- **Genoa from 2026-10-01 at $0.015/vCPU-h + $0.0045/GiB-h: CONFIRMED.** 4×0.015 + 16×0.0045 = $0.132/h, and about 1,106 h gives about $146. The arithmetic is correct.
  - Missed: `cpu-e2` (Ice Lake, eu-north1 only) is $0.012/vCPU-h + $0.0045/GiB-h, about $0.12/h or about $133.
- **Sandboxes: CONFIRMED.**
  - Beta; VM isolation; Git-like branching; "over 7,000" preloaded environments (SWE-bench Verified, SWE-rebench, SWE-rebench-V2).
  - At most 50 concurrent operations; 180-day retention for untagged images.
  - contree SDK, CLI and MCP.
  - `CONTREE_URL=https://api.tokenfactory.nebius.com/sandboxes`, and the SDK takes a Nebius API key.
  - The CLI docs recommend IAM token + `Project` header and accept `NEBIUS_API_KEY` as a fallback.
  - Pricing: UNVERIFIABLE; nothing in `llms-full.txt`.

**Section (d): Node/TS gotchas**
- **#1 (openai-node passes extra keys): CONFIRMED.** The openai-node README (v7.26.0) says: "doesn't validate at runtime… any extra values you send will be sent as-is". It also says response extras are not stripped.
- **#2, #3: CONFIRMED.** The cookbook notes use `us-central1` and give the lowercase Nano ID. The notebooks use the global base. The cost benchmark goes through the `ChatNebius` default, whose base URL is not shown.
- **#4: CONFIRMED**, and reinforced by the NVIDIA parser docstring.
- **#5: PARTIALLY WRONG.**
  - Read `reasoning_content ?? reasoning`: fine.
  - "Do not feed reasoning back" is wrong for multi-step tool loops. The template re-renders `reasoning_content` for assistant turns after the last user message, and the TF request schema accepts `reasoning_content` on messages.
  - For single-shot "plan as data" calls it does not matter.
- **#6, #7: CONFIRMED.**
- **#8: CONFIRMED.** Add `strict: true` on the forced tool, since `ChatCompletionTool.strict` is in the schema.
- **#9, #10: CONFIRMED.**
- **#11: PARTIALLY WRONG.** `seed` is absent from the TF schema, but OpenRouter lists `seed` for the Nebius Nano endpoint, the schema allows additional properties, and the docs claim full vLLM parameter support. Seed probably passes through. Determinism is still not guaranteed, so record and replay stands.
- **#12: CONFIRMED.**
  - Speculative-decoding retention in Finland unless ZDR; ZDR is org-level and "may impact … inference speed".
  - Data Lab collects chat completions unless ZDR is on.
  - The legal guide says content is "not used to train any models", which contradicts the `store` field's "distillation" wording.
- **#13:** "No reroute" CONFIRMED. The "1–2 months' notice" claim is UNVERIFIABLE; the notices carry no publish dates.
- **#14: CONFIRMED** (rules plus billing auto-charge).

**Feedback-log items**
- **1–4, 6–10: CONFIRMED.**
- **5: PARTIAL.** The cookbook links to the 404 page; the rate-limit doc has no link at all.

### (3) Important facts the report missed

1. **A free way to get per-model limits and features.** `GET /v1/models?verbose=true` returns `RichModel` with `context_length`, `pricing`, `per_request_limits` (`tokens_per_minute`, `requests_per_minute`, `burst_ratio`), `supported_features` and `supported_sampling_parameters`. That covers per-model rate limits and possibly json_schema/tools support without any paid call.
   - Source: OpenAPI and https://docs.tokenfactory.nebius.com/api-reference/examples/list-of-models.md.
   - The doc's example shows 800k TPM / 1200 RPM on a sample model, which differs from the 60 RPM / 400k TPM baseline example.
2. **The effort knobs are plain prompt text, so they can be emulated.** `low_effort` and `medium_effort` only append `{reasoning effort: low}` or `{reasoning effort: efficient}` to the last user message. A client can append that string itself if TF ignores `chat_template_kwargs`.
   - `enable_thinking:false` cannot be emulated the same way, because it prefills `<think></think>`. It could be done through `/v1/completions` with a hand-templated `<|im_start|>` prompt.
3. **The empty-`content` failure mode with thinking off.** If TF uses a plain deepseek_r1-style parser rather than NVIDIA's plugin, the answer can land in `reasoning_content` with `content` null when thinking is off or truncated. The client should fall back to the reasoning field.
4. **Batch exists through Data Lab, not `/v1/batches`.**
   - The public OpenAPI (20260930) has no `/v1/batches` path. It does have `FilePurpose: batch` and a Data Lab operation type `batch_inference` (`CreateBatchInferenceOperationRequest`, params `{model, completion_window}`, posted to `/v1/operations`, results written to datasets).
   - Batch outputs are processed in eu-north1.
   - Team-access docs list a "Batch API" permission.
5. **`ChatCompletionTool.strict`** is in the chat schema ("Only a subset of JSON Schema is supported when strict is true"). The Responses API also has a `Grammar` type with lark/regex syntax.
6. **`service_tier`** has an undocumented `no-limit` value, and `service_tier` is a required response field, so over-limit serving can be detected per response.
7. **Lightning does not beat Nano everywhere.** In the unified table, Nano wins on IFBench loose (72.17 vs 71.88) and AA-Omniscience (20.15 vs 17.50). Lightning wins clearly on coding and agentic work, is about 5× faster on TF (314 vs 60 tok/s), costs the same, and has 4× the context. Super is 63.08 vs Lightning's 51.56 on SWE-bench Verified.
8. **Other TF-hosted models score higher than Ultra** on SWE-bench Verified per Ultra's own BF16 card: GLM-5.1 76.2, Kimi-K2.6 75.7, DS-V4-Pro 74.5, Qwen3.5 73.6, against Ultra's 70.7. Two judging criteria explicitly score "how effectively [it uses] … NVIDIA Nemotron", so a non-Nemotron baseline would hurt the optics.
9. **A judge wrote one of the cookbooks.** AbdulMajed Raja (TF DevRel Lead, APJ) authored the TF OpenCode cookbook. The cost benchmark is by Sujee Maniyam, who is not a judge. A Serverless AI TPM is also on the panel, which matters for any AI Cloud decision.
10. **OpenRouter offers free `:free` variants** of Super, Ultra and Lightning. They are useless for Stage 1 (TF is required) but could tempt a baseline; avoid them.
11. **Builders banner** on nebius.com: "AI Builder Program: $400+ in credits and discounts".
12. **More docs defects for the feedback log:**
    - json.md examples are broken: missing commas in the Python sample, `"response format"` with a space as a key in curl, and models not in the catalog (`Qwen/Qwen3-235B-A22B`, `mistralai/Mistral-Nemo-Instruct-2407`).
    - The docs read `message.refusal`, which is not in the response schema.
    - Super's catalog `policy_url` points to the Llama 3.1 use policy.
    - The August deprecation page is still worded in the future tense.
    - The non-stream response schema lacks reasoning fields that the stream delta has.
13. **Still UNVERIFIABLE without a key or a paid call:**
    - `chat_template_kwargs` and `reasoning_effort` behaviour on TF
    - json_schema on Nemotron
    - per-model limits (free via verbose `/v1/models` once a key exists)
    - `n>1` billing
    - batch discount and Nemotron eligibility
    - Sandboxes pricing
    - promo-code expiry
    - the Nebius blog date for Super's TF launch (catalog `created_at` 2026-03-11 confirmed)

// The pinned model table (plan §3.6): Token Factory ids, which are case-sensitive, prices in USD per 1M tokens, and the
// display name every report uses. Source: the TF catalog https://tokenfactory.nebius.com/api/public/models_info, pinned
// 2026-10-01 and matched by the free verbose catalog in the gate probes (docs/gates/tf-probes.md).
import type { ModelKey, TemplateKwargs } from './types.js';

export interface PinnedModel {
  id: string;
  /** `Nemotron 3 Ultra`: what plan.md, the demo report, the ledger page and the bench call it. */
  name: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  /** The context Token Factory serves (`max_model_len`): prompt plus max_tokens must fit (docs/research/02-token-factory.md). */
  contextTokens: number;
}

export const models: Readonly<Record<ModelKey, PinnedModel>> = {
  super: { id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super', inputUsdPerMillion: 0.3, outputUsdPerMillion: 0.9, contextTokens: 262_144 },
  ultra: { id: 'nvidia/Nemotron-3-Ultra-550b-a55b', name: 'Nemotron 3 Ultra', inputUsdPerMillion: 1.0, outputUsdPerMillion: 3.0, contextTokens: 1_048_576 },
  lightning: { id: 'nvidia/Nemotron-3_5-Lightning', name: 'Nemotron 3.5 Lightning', inputUsdPerMillion: 0.06, outputUsdPerMillion: 0.24, contextTokens: 1_048_576 },
  // Released 2026-10-15; the TF catalog read 2026-10-20 (bf16, 1M context, reasoning on by default).
  'super-vl': { id: 'nvidia/Nemotron-3.5-Super-VL', name: 'Nemotron 3.5 Super VL', inputUsdPerMillion: 0.3, outputUsdPerMillion: 0.9, contextTokens: 1_048_576 },
};

export const isModelKey = (value: unknown): value is ModelKey => typeof value === 'string' && Object.hasOwn(models, value);

/** How a request's chat_template_kwargs set the model's reasoning; with no flag every pinned model thinks (tf-probes.md). */
export const reasoningMode = (kwargs: TemplateKwargs) =>
  kwargs.medium_effort ? 'medium_effort' : kwargs.low_effort ? 'low_effort' : kwargs.enable_thinking === false ? 'thinking off' : 'thinking on';

// The pinned model table (plan §3.6): Token Factory ids, which are case-sensitive, and prices in USD per 1M tokens.
// Source: the TF catalog https://tokenfactory.nebius.com/api/public/models_info, pinned 2026-10-01 and matched by the
// free verbose catalog in the gate probes (docs/gates/tf-probes.md).
import type { ModelKey } from './types.js';

export interface PinnedModel {
  id: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export const models: Readonly<Record<ModelKey, PinnedModel>> = {
  super: { id: 'nvidia/nemotron-3-super-120b-a12b', inputUsdPerMillion: 0.3, outputUsdPerMillion: 0.9 },
  ultra: { id: 'nvidia/Nemotron-3-Ultra-550b-a55b', inputUsdPerMillion: 1.0, outputUsdPerMillion: 3.0 },
  lightning: { id: 'nvidia/Nemotron-3_5-Lightning', inputUsdPerMillion: 0.06, outputUsdPerMillion: 0.24 },
};

export const isModelKey = (value: unknown): value is ModelKey => typeof value === 'string' && Object.hasOwn(models, value);

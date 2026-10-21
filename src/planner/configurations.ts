// Planner configurations (S8b): which Nemotron model edits the seeds draft and reviews the winner, and how it reasons.
// Samples, prompts and planner rules are the same in every configuration (edit.ts, critic.ts), and so are max tokens
// unless a configuration sets its own. A profile's replay pins (rules, critic prompt) belong to its recording, which
// every target made with the default configuration.
import type { ModelKey, TemplateKwargs } from '../gateway/types.js';

export type PlannerConfigurationName = 'ultra' | 'super-vl' | 'super-vl-low' | 'super-vl-direct' | 'super-vl-long';

/** One call's model and its reasoning control (chat_template_kwargs); max tokens per choice when not the default. */
export interface ModelSettings {
  model: ModelKey;
  templateKwargs: TemplateKwargs;
  maxTokens?: number;
}

export interface PlannerConfiguration {
  edit: ModelSettings;
  critic: ModelSettings;
}

const both = (settings: ModelSettings): PlannerConfiguration => ({ edit: settings, critic: settings });

export const plannerConfigurations: Readonly<Record<PlannerConfigurationName, PlannerConfiguration>> = {
  /** Nemotron 3 Ultra on medium_effort: G1's best editor, and every recording up to S8. */
  ultra: both({ model: 'ultra', templateKwargs: { medium_effort: true } }),
  /** Nemotron 3.5 Super VL with thinking on: no template kwargs, as NVIDIA recommends. */
  'super-vl': both({ model: 'super-vl', templateKwargs: {} }),
  'super-vl-low': both({ model: 'super-vl', templateKwargs: { low_effort: true } }),
  /** Super VL with thinking off. With thinking on (S8b), every hoppscotch edit choice reasoned to the 64k cap before answering. */
  'super-vl-direct': both({ model: 'super-vl', templateKwargs: { enable_thinking: false } }),
  /**
   * Super VL with thinking on and room to finish: the edit's choices 512k tokens each, the critic 256k (S8c). Both
   * stream (above 64k, request.ts), and both fit its 1,048,576-token context with any prompt we send (at most 27,310
   * tokens recorded).
   */
  'super-vl-long': { edit: { model: 'super-vl', templateKwargs: {}, maxTokens: 512_000 }, critic: { model: 'super-vl', templateKwargs: {}, maxTokens: 256_000 } },
};

export const defaultPlannerConfiguration: PlannerConfigurationName = 'ultra';

export const plannerConfigurationNames = Object.keys(plannerConfigurations) as PlannerConfigurationName[];

export const isPlannerConfigurationName = (value: unknown): value is PlannerConfigurationName =>
  typeof value === 'string' && Object.hasOwn(plannerConfigurations, value);

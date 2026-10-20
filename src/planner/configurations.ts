// Planner configurations (S8b): which Nemotron model edits the seeds draft and reviews the winner, and how it reasons.
// Samples, max tokens, prompts and planner rules are the same in every configuration (edit.ts, critic.ts). A profile's
// replay pins (rules, critic prompt) belong to its recording, which every target made with the default configuration.
import type { ModelKey, TemplateKwargs } from '../gateway/types.js';

export type PlannerConfigurationName = 'ultra' | 'super-vl' | 'super-vl-low';

/** One call's model and its reasoning control (chat_template_kwargs). */
export interface ModelSettings {
  model: ModelKey;
  templateKwargs: TemplateKwargs;
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
};

export const defaultPlannerConfiguration: PlannerConfigurationName = 'ultra';

export const plannerConfigurationNames = Object.keys(plannerConfigurations) as PlannerConfigurationName[];

export const isPlannerConfigurationName = (value: unknown): value is PlannerConfigurationName =>
  typeof value === 'string' && Object.hasOwn(plannerConfigurations, value);

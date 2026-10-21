// Planner configurations (S8b): the table, the edit and critic settings each one gives, the replay pins that hold for
// the default configuration only, the requests each one sends, and the labels plan.md and the bench print.
import { describe, expect, it } from 'vitest';
import { plannerMethod } from '../../src/bench/planner.js';
import { loadProfile } from '../../src/certificate/profile.js';
import { models } from '../../src/gateway/models.js';
import { buildRequestBody, type RequestBody } from '../../src/gateway/request.js';
import type { Gateway, ModelKey, StructuredRequest, TemplateKwargs } from '../../src/gateway/types.js';
import { defaultPlannerConfiguration, isPlannerConfigurationName, plannerConfigurationNames, plannerConfigurations } from '../../src/planner/configurations.js';
import { criticSettingsFor, defaultCriticSettings } from '../../src/planner/critic.js';
import { defaultEditSettings, editSettingsFor, runEdit } from '../../src/planner/edit.js';
import { modelLabel } from '../../src/planner/outputs.js';

describe('planner configurations', () => {
  it('are Ultra on medium_effort (the default), Super VL thinking on (no template kwargs) and Super VL on low_effort', () => {
    expect(plannerConfigurationNames).toEqual(['ultra', 'super-vl', 'super-vl-low', 'super-vl-direct', 'super-vl-long', 'super-vl-256k']);
    expect(defaultPlannerConfiguration).toBe('ultra');
    expect(plannerConfigurations).toEqual({
      ultra: { edit: { model: 'ultra', templateKwargs: { medium_effort: true } }, critic: { model: 'ultra', templateKwargs: { medium_effort: true } } },
      'super-vl': { edit: { model: 'super-vl', templateKwargs: {} }, critic: { model: 'super-vl', templateKwargs: {} } },
      'super-vl-low': { edit: { model: 'super-vl', templateKwargs: { low_effort: true } }, critic: { model: 'super-vl', templateKwargs: { low_effort: true } } },
      'super-vl-direct': { edit: { model: 'super-vl', templateKwargs: { enable_thinking: false } }, critic: { model: 'super-vl', templateKwargs: { enable_thinking: false } } },
      'super-vl-long': { edit: { model: 'super-vl', templateKwargs: {}, maxTokens: 512_000 }, critic: { model: 'super-vl', templateKwargs: {}, maxTokens: 256_000 } },
      'super-vl-256k': { edit: { model: 'super-vl', templateKwargs: {}, maxTokens: 256_000 }, critic: { model: 'super-vl', templateKwargs: {}, maxTokens: 128_000 } },
    });
    expect([isPlannerConfigurationName('super-vl-low'), isPlannerConfigurationName('nano'), isPlannerConfigurationName('toString')]).toEqual([true, false, false]);
  });

  it('keep the default settings as they were: Ultra on medium_effort, K=3 edits of 64k tokens, one 32k-token review with prompt 2', () => {
    expect(defaultEditSettings).toEqual({ model: 'ultra', templateKwargs: { medium_effort: true }, samples: 3, maxTokens: 64_000, rules: 2 });
    expect(defaultCriticSettings).toEqual({ model: 'ultra', templateKwargs: { medium_effort: true }, maxTokens: 32_000, samples: 1, prompt: 2 });
  });

  it.each(plannerConfigurationNames)('%s changes the model and its reasoning only: samples, max tokens, prompt and rules stay', (configuration) => {
    const { edit, critic } = plannerConfigurations[configuration];
    expect(editSettingsFor(null, 'auto', configuration)).toEqual({ ...defaultEditSettings, ...edit });
    expect(criticSettingsFor(null, 'auto', configuration)).toEqual({ ...defaultCriticSettings, ...critic });
  });

  it("holds a profile's replay pins for the default configuration only: they belong to its recording", () => {
    const immich = loadProfile('immich');
    expect([editSettingsFor(immich, 'replay').rules, criticSettingsFor(immich, 'replay').prompt]).toEqual([1, 1]);
    expect([editSettingsFor(immich, 'replay', 'ultra').rules, criticSettingsFor(immich, 'replay', 'ultra').prompt]).toEqual([1, 1]);
    for (const configuration of ['super-vl', 'super-vl-low'] as const) {
      expect([editSettingsFor(immich, 'replay', configuration).rules, criticSettingsFor(immich, 'replay', configuration).prompt], configuration).toEqual([2, 2]);
    }
    expect(() => editSettingsFor({ plan: { rules: 9 } }, 'replay', 'super-vl')).toThrow('no planner rules version 9');
  });

  it('gives super-vl-long and super-vl-256k room to finish their reasoning, and every other configuration the default caps', () => {
    expect([editSettingsFor(null, 'auto', 'super-vl-long').maxTokens, criticSettingsFor(null, 'auto', 'super-vl-long').maxTokens]).toEqual([512_000, 256_000]);
    expect([editSettingsFor(null, 'auto', 'super-vl-256k').maxTokens, criticSettingsFor(null, 'auto', 'super-vl-256k').maxTokens]).toEqual([256_000, 128_000]);
    for (const configuration of ['ultra', 'super-vl', 'super-vl-low', 'super-vl-direct'] as const) {
      expect([editSettingsFor(null, 'auto', configuration).maxTokens, criticSettingsFor(null, 'auto', configuration).maxTokens], configuration).toEqual([64_000, 32_000]);
    }
  });

  it('stream the calls of super-vl-long and super-vl-256k only (above 64k max_tokens); every other configuration sends its bodies as before', () => {
    const streams = ({ model, templateKwargs, maxTokens }: { model: ModelKey; templateKwargs: TemplateKwargs; maxTokens: number }) => {
      const body = buildRequestBody({ model, templateKwargs, maxTokens, messages: [{ role: 'user', content: 'x' }], schemaName: 'x', schema: {}, parse: (value) => value, n: 3 });
      return [body.stream, body.stream_options];
    };
    for (const configuration of plannerConfigurationNames) {
      const expected = configuration === 'super-vl-long' || configuration === 'super-vl-256k' ? [true, { include_usage: true }] : [undefined, undefined];
      expect(streams(editSettingsFor(null, 'auto', configuration)), configuration).toEqual(expected);
      expect(streams(criticSettingsFor(null, 'auto', configuration)), configuration).toEqual(expected);
    }
  });

  it("fit every configuration's caps into its model's context with room for a prompt four times the largest recorded", () => {
    // The largest prompt in the committed cassettes: 27,310 tokens, a Super VL critic on hoppscotch (S8b).
    const prompt = 4 * 27_310;
    for (const configuration of plannerConfigurationNames) {
      for (const settings of [editSettingsFor(null, 'auto', configuration), criticSettingsFor(null, 'auto', configuration)]) {
        expect(prompt + settings.maxTokens, configuration).toBeLessThanOrEqual(models[settings.model].contextTokens);
      }
    }
    expect(models['super-vl'].contextTokens).toBe(1_048_576);
  });

  it.each([
    ['ultra', models.ultra.id, { medium_effort: true }],
    ['super-vl', 'nvidia/Nemotron-3.5-Super-VL', undefined],
    ['super-vl-low', 'nvidia/Nemotron-3.5-Super-VL', { low_effort: true }],
    ['super-vl-direct', 'nvidia/Nemotron-3.5-Super-VL', { enable_thinking: false }],
  ] as const)('%s sends the edit to %s with chat_template_kwargs %o', async (configuration, modelId, kwargs) => {
    const bodies: RequestBody[] = [];
    const gateway: Gateway = {
      async structured<T>(request: StructuredRequest<T>) {
        bodies.push(buildRequestBody(request as StructuredRequest<unknown>));
        return { choices: [], usage: null, costUsd: 0, replayed: true, key: 'fake' };
      },
      spent: () => ({ run: 0, global: 0 }),
    };
    await runEdit(gateway, { system: 'system', user: 'user', groupIds: new Map([['album', 'G1']]) }, editSettingsFor(null, 'auto', configuration));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ model: modelId, n: 3, max_tokens: 64_000 });
    expect(bodies[0]!.chat_template_kwargs).toEqual(kwargs);
  });

  it("labels the model and its reasoning in plan.md and in the bench's planner row; Ultra's labels stay as they were", () => {
    expect(modelLabel('ultra', { medium_effort: true })).toBe('Nemotron 3 Ultra (medium_effort)');
    expect(modelLabel('lightning', { enable_thinking: false })).toBe('Nemotron 3.5 Lightning (thinking off)');
    expect(modelLabel('super-vl', {})).toBe('Nemotron 3.5 Super VL (thinking on)');
    expect(modelLabel('super-vl', { low_effort: true })).toBe('Nemotron 3.5 Super VL (low_effort)');
    expect(modelLabel('super-vl', { enable_thinking: false })).toBe('Nemotron 3.5 Super VL (thinking off)');
    expect(plannerConfigurationNames.map(plannerMethod)).toEqual(['planner (Ultra)', 'planner (Super VL, thinking on)', 'planner (Super VL, low_effort)', 'planner (Super VL, thinking off)', 'planner (Super VL, thinking on, 512k)', 'planner (Super VL, thinking on, 256k)']);
  });
});

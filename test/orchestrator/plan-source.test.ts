// Where a run's plan comes from: a plan.yaml with the cost its plan.md records, or the planner in-process, which must
// replay a cassette `ac plan` recorded (same settings, same requests) and spend nothing.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { createGateway } from '../../src/gateway/gateway.js';
import type { RequestBody } from '../../src/gateway/request.js';
import type { Transport } from '../../src/gateway/transport.js';
import { defaultCriticSettings } from '../../src/planner/critic.js';
import { defaultEditSettings } from '../../src/planner/edit.js';
import { planOutputs } from '../../src/planner/outputs.js';
import { planRepo } from '../../src/planner/plan.js';
import { planFromFile, planInProcess } from '../../src/orchestrator/plan-source.js';
import { startRun } from '../../src/orchestrator/run.js';
import { fixtureRepo, profileOf } from './fixture.js';

const fixture = fixtureRepo();
afterAll(() => fs.rmSync(fixture.scratch, { recursive: true, force: true }));

describe('plan sources', () => {
  it('reads a plan.yaml and the cost its plan.md recorded', () => {
    const directory = path.join(fixture.scratch, 'plan-file');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'plan.yaml'), 'version: 1\n');
    expect(planFromFile(path.join(directory, 'plan.yaml')).plan.recordedCostUsd).toBeNull();
    fs.writeFileSync(path.join(directory, 'plan.md'), '# plan\n\n- Cost: **$0.1961** in 2 calls (34413 prompt).\n');
    expect(planFromFile(path.join(directory, 'plan.yaml'))).toEqual({
      plan: { text: 'version: 1\n', source: path.join(directory, 'plan.yaml'), files: new Map(), recordedCostUsd: 0.1961 },
      cost: { budgetRun: null, mode: null, llmUsd: 0 },
    });
  });

  it('plans in-process exactly as `ac plan` does: a recorded cassette replays to the same plan, for $0', async () => {
    const budget = path.join(fixture.scratch, 'budget');
    fs.mkdirSync(budget);
    fs.writeFileSync(path.join(budget, 'runs.json'), JSON.stringify({ globalCap: 1, runs: { test: { cap: 1 } } }));
    const cassette = path.join(fixture.scratch, 'cassette.jsonl');
    // Answers no schema accepts: every candidate is an error, the seeds draft wins, and no critic call follows.
    const unusable: Transport = async (body: RequestBody) => {
      const choices = Array.from({ length: (body as { n?: number }).n ?? 1 }, (_, index) => ({ index, finish_reason: 'stop', message: { role: 'assistant', content: '{}', reasoning_content: '' } }));
      return { status: 200, headers: {}, bodyText: JSON.stringify({ id: 'fake', object: 'chat.completion', choices, usage: { prompt_tokens: 10, completion_tokens: 3 } }) };
    };
    const gateway = createGateway({ runId: 'test', mode: 'record', cassettePath: cassette, ledgerPath: path.join(budget, 'ledger.jsonl'), runsPath: path.join(budget, 'runs.json'), transport: unusable, apiKey: 'test-key' });
    const settings = { edit: defaultEditSettings, critic: defaultCriticSettings };
    const recorded = await planRepo(gitRepoFs(fixture.repo), gateway, { packageRoot: 'server', moduleRoot: 'src', pins: [], ...settings });
    const outputs = planOutputs(recorded, { name: 'fixture' }, settings);

    const planned = await planInProcess({ repo: fixture.repo, profile: profileOf(), cassette, mode: 'replay', run: null });
    expect(planned.plan.text).toBe(outputs.get('plan.yaml'));
    expect(planned.plan.source).toBe('planner');
    expect(planned.plan.files.get('plan.md')).toBe(outputs.get('plan.md'));
    expect([...planned.plan.files.keys()].some((file) => file.startsWith('steps/') || file === 'plan.yaml')).toBe(false);
    expect(planned.cost).toEqual({ budgetRun: null, mode: 'replay', llmUsd: 0 });

    const run = await startRun({
      repo: fixture.repo, environment: fixture.repo, profile: profileOf(), plan: planned.plan, cost: planned.cost, runDirectory: path.join(fixture.scratch, 'run'),
      branch: 'ac/run-planned', rungs: ['R1'], maxSteps: 0, jobs: 1, injectFault: null, log: () => {},
    });
    expect(run.state).toMatchObject({ status: 'stopped', plan: { source: 'planner' }, cost: { mode: 'replay', llmUsd: 0 } });
    expect(fs.readFileSync(path.join(fixture.scratch, 'run', 'plan', 'plan.yaml'), 'utf8')).toBe(planned.plan.text);
    expect(fs.existsSync(path.join(fixture.scratch, 'run', 'plan', 'plan.md'))).toBe(true);
    expect(fs.readdirSync(path.join(fixture.scratch, 'run', 'plan', 'steps')).length).toBe(run.state.plan.steps);
  });
});

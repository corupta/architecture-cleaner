// The findings narrator: the guard that drops any narration naming what its evidence doesn't contain, and the
// requests it sends through the real gateway (record with a fake transport, then a byte-identical replay offline).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultNarrationSettings, namedTokens, narrateFindings, narrationProblem } from '../../src/findings/narrate.js';
import { findingId, type Finding } from '../../src/findings/types.js';
import { createGateway } from '../../src/gateway/gateway.js';
import type { RequestBody } from '../../src/gateway/request.js';
import type { Transport } from '../../src/gateway/transport.js';

const evidence = 'BaseService (server/src/services/base.service.ts) takes 56 constructor-injected members, and 51 classes extend it.\nMost read: logger (33 classes), jobRepository (23 classes).';

describe('the narration guard', () => {
  it('collects paths, identifiers and numbers, and lets plain words through', () => {
    expect(namedTokens('BaseService hands 56 members to every subclass, e.g. `this.jobRepository`; see server/src/services/base.service.ts.'))
      .toEqual(['this.jobRepository', 'BaseService', '56', 'server/src/services/base.service.ts']);
    expect(namedTokens('A multi-writer table is a well-known smell in the K4 check of a PR.')).toEqual(['K4']);
  });

  it('keeps a narration that only restates the evidence', () => {
    expect(narrationProblem('BaseService gives all 56 injected members to 51 classes, though most read only a few, like jobRepository.', evidence, 360)).toBeNull();
    expect(narrationProblem('The logger is read by 33 classes.', evidence, 360)).toBeNull();
  });

  it('drops a narration that names a path, identifier or number the evidence lacks, an empty one and a long one', () => {
    expect(narrationProblem('It lives in server/src/services/album.service.ts.', evidence, 360)).toBe('names "server/src/services/album.service.ts", which the evidence doesn\'t contain');
    expect(narrationProblem('AlbumService reads only two of them.', evidence, 360)).toBe('names "AlbumService", which the evidence doesn\'t contain');
    expect(narrationProblem('About 10% of the members are read by each class.', evidence, 360)).toBe('names "10", which the evidence doesn\'t contain');
    expect(narrationProblem('Each class reads 5 of the 56.', evidence, 360)).toBe('names "5", which the evidence doesn\'t contain');
    expect(narrationProblem('', evidence, 360)).toBe('empty');
    expect(narrationProblem('word '.repeat(80).trim(), evidence, 360)).toBe('longer than 360 characters');
  });
});

const finding = (title: string, findingEvidence: string): Finding => ({
  id: findingId('god-injection', title), kind: 'god-injection', title, files: [], evidence: findingEvidence, source: 'facts', steps: [], certificates: [], weight: 1, narration: null,
});

describe('narrateFindings through the gateway', () => {
  it('sends strict json_schema requests to Lightning with thinking off, and replays them offline', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-narrate-'));
    try {
      const runsPath = path.join(directory, 'runs.json');
      fs.writeFileSync(runsPath, JSON.stringify({ globalCap: 50, runs: { test: { cap: 1 } } }));
      const cassettePath = path.join(directory, 'cassette.jsonl');
      const ledgerPath = path.join(directory, 'ledger.jsonl');
      const findings = [finding('BaseService injects 56 members into 51 classes', evidence), finding('Table asset is written by 4 groups', 'Table asset is written by 4 files in 4 plan groups.')];
      const bodies: RequestBody[] = [];
      const transport: Transport = async (body) => {
        bodies.push(body);
        const narrations = [{ id: findings[0]!.id, text: 'BaseService hands all 56 members to 51 classes.' }, { id: findings[1]!.id, text: 'Four groups write table asset, per server/src/x.ts.' }];
        return { status: 200, headers: {}, bodyText: JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { content: JSON.stringify({ narrations }) } }], usage: { prompt_tokens: 400, completion_tokens: 60 } }) };
      };
      const recorded = await narrateFindings(createGateway({ runId: 'test', mode: 'record', cassettePath, ledgerPath, runsPath, transport }), findings);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toMatchObject({ model: 'nvidia/Nemotron-3_5-Lightning', max_tokens: 64 + 2 * defaultNarrationSettings.tokensPerFinding, chat_template_kwargs: { enable_thinking: false } });
      expect(bodies[0]!.response_format.json_schema).toMatchObject({ name: 'findings_narration', strict: true });
      expect([...recorded.narrations]).toEqual([[findings[0]!.id, 'BaseService hands all 56 members to 51 classes.']]);
      expect(recorded.record).toMatchObject({ calls: 1, replayed: false, narrated: 1, dropped: [{ id: findings[1]!.id, reason: 'names "server/src/x.ts", which the evidence doesn\'t contain' }] });
      expect(recorded.record.costUsd).toBeGreaterThan(0);

      const ledgerBefore = fs.readFileSync(ledgerPath, 'utf8');
      const replayed = await narrateFindings(createGateway({ runId: 'replay', mode: 'replay', cassettePath, ledgerPath, runsPath }), findings);
      expect(replayed.narrations).toEqual(recorded.narrations);
      expect(replayed.record).toEqual({ ...recorded.record, replayed: true });
      expect(fs.readFileSync(ledgerPath, 'utf8')).toBe(ledgerBefore);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

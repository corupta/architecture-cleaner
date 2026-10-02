// Planner v0 (G1): facts + deterministic draft → Nemotron plan (json_schema strict) → 1 evaluate round → final plan.
import { chat, models, reasoningOf } from '../llm/client.mjs';

const bannedNames = ['common', 'core', 'misc', 'general', 'helpers', 'helper', 'utils', 'util', 'lib', 'base', 'manager', 'shared', 'platform',
  'controllers', 'services', 'repositories', 'dtos', 'models', 'entities', 'types', 'interfaces'];

const planSchema = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['module', 'shared', 'platform'] },
          files: { type: 'array', items: { type: 'integer' } },
        },
        required: ['name', 'kind', 'files'],
        additionalProperties: false,
      },
    },
    contested: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'integer' }, group: { type: 'string' }, rationale: { type: 'string' } },
        required: ['file', 'group', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups', 'contested'],
  additionalProperties: false,
};

const systemPrompt = `You are a senior software architect restructuring a TypeScript backend that is sliced by technical type (controllers/, services/, repositories/, dtos/ ...) into feature modules. You only draw the map: which group each file belongs to. Code is moved later by a deterministic tool.

Target layout:
- modules/<name>: one per business feature. <name> is a singular kebab-case domain noun taken from the repo's own vocabulary (route prefixes, table/model names, file stems). Never invent business terms.
- shared/<concept>: pure code (no I/O, no framework) used by at least two modules.
- platform/<concept>: plumbing such as config, database client, logger, generic HTTP middleware, queue, mail transport, telemetry, registries.
Banned module names: ${bannedNames.join(', ')}.

Rules:
- Every file id appears in exactly one group.
- Files that import each other heavily belong together; a file used by only one module belongs inside that module, not in shared/.
- Tables a file reads or writes are strong evidence for its feature; the module that writes a table usually owns it.
- The draft comes from deterministic name tokens and label propagation. Keep what is right, fix what is wrong, merge or split where it helps cohesion.
- Each group's "name" is the bare name (e.g. "album", "database"), without a "modules/", "shared/" or "platform/" prefix; that goes in "kind". Omit empty groups.
- In "contested", list every file whose placement is a judgment call (draft confidence weak/contested/isolated, or you moved it away from the draft), each with a one-line rationale.`;

export function buildFacts(view, draft) {
  const keys = view.nodes.map((node) => node.key).sort();
  const idOf = new Map(keys.map((key, index) => [key, index + 1]));
  const nodeOf = new Map(view.nodes.map((node) => [node.key, node]));
  const outgoing = new Map();
  for (const edge of view.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(`${edge.typeOnly ? '~' : ''}${idOf.get(edge.to)}`);
    outgoing.set(edge.from, list);
  }
  const lines = keys.map((key) => {
    const node = nodeOf.get(key);
    const exportsText = node.exports.length ? ` ex:${node.exports.slice(0, 4).join(',')}${node.exports.length > 4 ? `,+${node.exports.length - 4}` : ''}` : '';
    const tables = node.tables && (node.tables.reads.length || node.tables.writes.length)
      ? ` tbl:${node.tables.reads.length ? `r[${node.tables.reads.join(',')}]` : ''}${node.tables.writes.length ? `w[${node.tables.writes.join(',')}]` : ''}` : '';
    const imports = outgoing.get(key)?.length ? ` →${outgoing.get(key).join(',')}` : '';
    return `${idOf.get(key)} ${key} ${node.type} L${node.loc}${exportsText}${tables}${imports}`;
  });
  const draftGroups = new Map();
  for (const key of keys) {
    const label = draft.assignment.get(key);
    draftGroups.set(label, [...(draftGroups.get(label) ?? []), idOf.get(key)]);
  }
  const draftLines = [...draftGroups.entries()].sort((a, b) => b[1].length - a[1].length).map(([label, ids]) => `${label}: ${ids.join(',')}`);
  const contestedLines = draft.contested.map((key) => `${idOf.get(key)}(${draft.confidence.get(key)})`);
  const text = `FILES (id path type L<lines> ex:<exports> tbl:r[read tables]w[written tables] →<imported file ids; ~ = type-only>)\n${lines.join('\n')}\n\nDRAFT GROUPS (label: file ids)\n${draftLines.join('\n')}\n\nDRAFT LOW-CONFIDENCE FILES\n${contestedLines.join(' ')}`;
  return { text, keys, idOf };
}

function tarjan(nodes, adjacency) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlink = new Map();
  const components = [];
  const strongConnect = (node) => {
    indices.set(node, index);
    lowlink.set(node, index);
    index++;
    stack.push(node);
    onStack.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (!indices.has(next)) {
        strongConnect(next);
        lowlink.set(node, Math.min(lowlink.get(node), lowlink.get(next)));
      } else if (onStack.has(next)) lowlink.set(node, Math.min(lowlink.get(node), indices.get(next)));
    }
    if (lowlink.get(node) === indices.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component);
    }
  };
  for (const node of nodes) if (!indices.has(node)) strongConnect(node);
  return components;
}

// Deterministic validator metrics (the evaluate_plan tool's output).
export function evaluatePlan(plan, facts, view) {
  const assignment = new Map();
  const duplicates = [];
  const unknown = [];
  for (const group of plan.groups) {
    const name = groupName(group);
    for (const id of group.files) {
      const key = facts.keys[id - 1];
      if (!key) unknown.push(id);
      else if (assignment.has(key)) duplicates.push(id);
      else assignment.set(key, name);
    }
  }
  const missing = facts.keys.filter((key) => !assignment.has(key)).map((key) => facts.idOf.get(key));
  const sizes = new Map();
  for (const name of assignment.values()) sizes.set(name, (sizes.get(name) ?? 0) + 1);
  const moduleAdjacency = new Map();
  let crossEdges = 0;
  let totalEdges = 0;
  const pull = new Map();
  for (const edge of view.edges) {
    const from = assignment.get(edge.from);
    const to = assignment.get(edge.to);
    if (!from || !to) continue;
    totalEdges++;
    for (const [key, other] of [[edge.from, to], [edge.to, from]]) {
      const votes = pull.get(key) ?? new Map();
      votes.set(other, (votes.get(other) ?? 0) + edge.weight);
      pull.set(key, votes);
    }
    if (from === to) continue;
    crossEdges++;
    if (!moduleAdjacency.has(from)) moduleAdjacency.set(from, new Set());
    moduleAdjacency.get(from).add(to);
  }
  const moduleCycles = tarjan([...sizes.keys()], moduleAdjacency).filter((component) => component.length > 1);
  const disagreements = [];
  for (const [key, votes] of pull) {
    const own = assignment.get(key);
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
    const ownWeight = votes.get(own) ?? 0;
    if (ranked[0][0] !== own && ranked[0][1] > ownWeight) disagreements.push({ id: facts.idOf.get(key), own, pulledTo: ranked[0][0], share: +(ranked[0][1] / total).toFixed(2), ownShare: +(ownWeight / total).toFixed(2) });
  }
  disagreements.sort((a, b) => b.share - a.share);
  const banned = plan.groups.filter((group) => group.kind === 'module' && bannedNames.includes(group.name.toLowerCase())).map((group) => group.name);
  return {
    files: facts.keys.length,
    missing,
    duplicates,
    unknown,
    groups: sizes.size,
    singletonGroups: [...sizes.entries()].filter(([, size]) => size === 1).map(([name]) => name),
    largestGroups: [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    sharedOrPlatformFiles: [...assignment.values()].filter((name) => !name.startsWith('module/')).length,
    crossGroupEdgeRatio: totalEdges ? +(crossEdges / totalEdges).toFixed(3) : 0,
    groupCycles: moduleCycles.map((component) => component.sort()),
    bannedNames: banned,
    graphDisagreements: disagreements.slice(0, 25),
    graphDisagreementCount: disagreements.length,
  };
}

function evaluationText(evaluation) {
  return `EVALUATION OF YOUR PLAN (deterministic validator)
files: ${evaluation.files}; missing ids: ${JSON.stringify(evaluation.missing)}; duplicate ids: ${JSON.stringify(evaluation.duplicates)}; unknown ids: ${JSON.stringify(evaluation.unknown)}
groups: ${evaluation.groups}; singleton groups: ${JSON.stringify(evaluation.singletonGroups)}; largest: ${JSON.stringify(evaluation.largestGroups)}
files in shared/platform: ${evaluation.sharedOrPlatformFiles}; cross-group edge ratio: ${evaluation.crossGroupEdgeRatio}
group cycles (strongly connected sets of groups): ${JSON.stringify(evaluation.groupCycles)}
banned module names: ${JSON.stringify(evaluation.bannedNames)}
files whose imports pull harder toward another group (${evaluation.graphDisagreementCount} total, top 25: id, own group, pulled to, pull share, own share): ${JSON.stringify(evaluation.graphDisagreements.map((d) => [d.id, d.own, d.pulledTo, d.share, d.ownShare]))}

Fix every missing/duplicate/unknown id. Reconsider the listed disagreements and cycles, but keep a placement when the domain clearly says so (record it in contested). Return the complete final plan in the same JSON format.`;
}

function parsePlan(response) {
  const choice = response.json?.choices?.[0];
  if (!choice) return { error: `status ${response.status}: ${response.text.slice(0, 300)}` };
  if (choice.finish_reason === 'length') return { error: 'finish_reason length', usage: response.json.usage };
  try {
    return { plan: JSON.parse(choice.message.content), usage: response.json.usage, reasoningChars: reasoningOf(choice.message)?.length ?? 0 };
  } catch (error) {
    return { error: `unparseable: ${error}`, usage: response.json.usage };
  }
}

const responseFormat = { type: 'json_schema', json_schema: { name: 'plan', strict: true, schema: planSchema } };

// One planner run: `samples` first-turn choices in a single n-call, then one evaluate round per choice.
export async function runPlanner({ runId, modelKey, view, draft, samples = 1, maxTokens = 64000, templateKwargs, label }) {
  const facts = buildFacts(view, draft);
  const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: facts.text }];
  const sampling = { temperature: 1.0, top_p: 0.95, max_tokens: maxTokens, response_format: responseFormat, ...(templateKwargs ? { chat_template_kwargs: templateKwargs } : {}) };
  const first = await chat(runId, { model: models[modelKey], messages, n: samples, ...sampling });
  const choices = first.json?.choices ?? [];
  const results = [];
  for (let index = 0; index < Math.max(samples, 1); index++) {
    const choice = choices[index];
    const firstParsed = choice ? parsePlan({ ...first, json: { ...first.json, choices: [choice] } }) : { error: `status ${first.status}: ${first.text.slice(0, 300)}` };
    if (!firstParsed.plan) {
      results.push({ label: `${label}#${index + 1}`, modelKey, error: `turn 1: ${firstParsed.error}`, usage: first.json?.usage });
      continue;
    }
    const evaluation1 = evaluatePlan(firstParsed.plan, facts, view);
    const second = await chat(runId, {
      model: models[modelKey],
      messages: [...messages, { role: 'assistant', content: choice.message.content }, { role: 'user', content: evaluationText(evaluation1) }],
      ...sampling,
    });
    const secondParsed = parsePlan(second);
    const finalPlan = secondParsed.plan ?? firstParsed.plan;
    results.push({
      label: `${label}#${index + 1}`,
      modelKey,
      turn1: { plan: firstParsed.plan, evaluation: evaluation1, reasoningChars: firstParsed.reasoningChars },
      turn2: secondParsed.plan ? { plan: secondParsed.plan, evaluation: evaluatePlan(secondParsed.plan, facts, view), reasoningChars: secondParsed.reasoningChars } : { error: secondParsed.error },
      finalPlan,
      usage: { turn1Shared: first.json?.usage, turn2: second.json?.usage },
    });
  }
  return { facts, results };
}

// Plan → Map(key → group name). Files the plan dropped become singleton "(unassigned)" groups.
export const groupName = (group) => `${group.kind}/${group.name.replace(/^(modules?|shared|platform)\//, '')}`;

export function planAssignment(plan, facts) {
  const assignment = new Map();
  for (const group of plan.groups) for (const id of group.files) {
    const key = facts.keys[id - 1];
    if (key && !assignment.has(key)) assignment.set(key, groupName(group));
  }
  for (const key of facts.keys) if (!assignment.has(key)) assignment.set(key, `(unassigned)/${key}`);
  return assignment;
}

// ---------------------------------------------------------------------------------------------------------------
// Planner v1 ("edit the draft"). v0 asked for every file id and failed at >=157 files (dropped and duplicated ids,
// empty or single-group "fixes"). v1 names and merges the draft groups and lists only the files that must move,
// so coverage is guaranteed by construction and the model spends its tokens on judgment calls.

const editSchema = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: { draft: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string', enum: ['module', 'shared', 'platform'] } },
        required: ['draft', 'name', 'kind'],
        additionalProperties: false,
      },
    },
    moves: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'integer' }, to: { type: 'string' }, rationale: { type: 'string' } },
        required: ['file', 'to', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups', 'moves'],
  additionalProperties: false,
};

const editSystemPrompt = `${systemPrompt.split('\nRules:')[0]}

You receive per-file facts and a DRAFT: groups G1..Gn produced deterministically from name tokens and label propagation. You edit the draft; you do not re-list files.

Output:
- "groups": exactly one entry per draft group id (G1..Gn): its final bare name (e.g. "album", "database"; no "modules/" prefix) and kind. Give two or more draft groups the same name to merge them.
- "moves": only files whose draft group is wrong: file id, the final group name it belongs to (an existing final name or a new one), and a one-line rationale. Use moves to split a draft group or rescue misplaced files. Files not listed stay with their draft group.

Rules:
- Files that import each other heavily belong together; a file used by only one module belongs inside that module, not in shared/.
- Tables a file reads or writes are strong evidence for its feature; the module that writes a table usually owns it.
- Draft groups named after a technical word, a verb, or a single file are usually wrong: merge them into the feature they serve or move their files.
- Low-confidence draft files are listed; decide each one (move it, or leave it if the draft is right).`;

export function buildEditFacts(view, draft) {
  const base = buildFacts(view, draft);
  const draftLabels = [...new Set(base.keys.map((key) => draft.assignment.get(key)))];
  const sizes = new Map(draftLabels.map((label) => [label, base.keys.filter((key) => draft.assignment.get(key) === label).length]));
  draftLabels.sort((a, b) => sizes.get(b) - sizes.get(a) || a.localeCompare(b));
  const groupIdOf = new Map(draftLabels.map((label, index) => [label, `G${index + 1}`]));
  const draftText = draftLabels.map((label) => `${groupIdOf.get(label)} "${label}": ${base.keys.filter((key) => draft.assignment.get(key) === label).map((key) => base.idOf.get(key)).join(',')}`).join('\n');
  const text = base.text.replace(/\n\nDRAFT GROUPS[\s\S]*?\n\nDRAFT LOW-CONFIDENCE FILES/, `\n\nDRAFT GROUPS (id "label": file ids)\n${draftText}\n\nDRAFT LOW-CONFIDENCE FILES`);
  return { ...base, text, draftLabels, groupIdOf };
}

// Edit plan → v0-style plan ({ groups: [{ name, kind, files }], contested }) so evaluation and scoring are shared.
export function applyEdit(edit, facts, draft) {
  const finalOf = new Map();
  for (const entry of edit.groups) finalOf.set(entry.draft, { name: entry.name.replace(/^(modules?|shared|platform)\//, ''), kind: entry.kind });
  const missingDraftGroups = [];
  const target = new Map();
  for (const key of facts.keys) {
    const draftId = facts.groupIdOf.get(draft.assignment.get(key));
    let final = finalOf.get(draftId);
    if (!final) {
      final = { name: draft.assignment.get(key), kind: 'module' };
      if (!missingDraftGroups.includes(draftId)) missingDraftGroups.push(draftId);
    }
    target.set(key, final);
  }
  const kindOfName = new Map([...finalOf.values()].map((final) => [final.name, final.kind]));
  const badMoves = [];
  for (const move of edit.moves) {
    const key = facts.keys[move.file - 1];
    if (!key) {
      badMoves.push(move.file);
      continue;
    }
    const name = move.to.replace(/^(modules?|shared|platform)\//, '');
    const kind = kindOfName.get(name) ?? (move.to.startsWith('shared/') ? 'shared' : move.to.startsWith('platform/') ? 'platform' : 'module');
    target.set(key, { name, kind });
  }
  const groups = new Map();
  for (const [key, final] of target) {
    const name = `${final.kind}\0${final.name}`;
    if (!groups.has(name)) groups.set(name, { name: final.name, kind: final.kind, files: [] });
    groups.get(name).files.push(facts.idOf.get(key));
  }
  return {
    plan: { groups: [...groups.values()], contested: edit.moves.map((move) => ({ file: move.file, group: move.to, rationale: move.rationale })) },
    missingDraftGroups,
    badMoves,
  };
}

function editEvaluationText(evaluation, applied) {
  return `${evaluationText(evaluation).split('\n\nFix every')[0]}
draft groups you did not name (kept as-is): ${JSON.stringify(applied.missingDraftGroups)}; moves with unknown file ids: ${JSON.stringify(applied.badMoves)}

Name every draft group. Reconsider the listed disagreements, cycles and singleton groups, but keep a placement when the domain clearly says so. Return the complete final edit (all groups, all moves) in the same JSON format.`;
}

function parseEdit(response) {
  const choice = response.json?.choices?.[0];
  if (!choice) return { error: `status ${response.status}: ${response.text.slice(0, 300)}` };
  if (choice.finish_reason === 'length') return { error: 'finish_reason length' };
  try {
    return { edit: JSON.parse(choice.message.content), reasoningChars: reasoningOf(choice.message)?.length ?? 0 };
  } catch (error) {
    return { error: `unparseable: ${error}` };
  }
}

export async function runEditPlanner({ runId, modelKey, view, draft, samples = 1, maxTokens = 64000, templateKwargs, label, evaluateRounds = 1 }) {
  const facts = buildEditFacts(view, draft);
  const messages = [{ role: 'system', content: editSystemPrompt }, { role: 'user', content: facts.text }];
  const sampling = {
    temperature: 1.0, top_p: 0.95, max_tokens: maxTokens,
    response_format: { type: 'json_schema', json_schema: { name: 'plan_edit', strict: true, schema: editSchema } },
    ...(templateKwargs ? { chat_template_kwargs: templateKwargs } : {}),
  };
  const first = await chat(runId, { model: models[modelKey], messages, n: samples, ...sampling });
  const choices = first.json?.choices ?? [];
  const results = [];
  for (let index = 0; index < samples; index++) {
    const choice = choices[index];
    const firstParsed = choice ? parseEdit({ ...first, json: { ...first.json, choices: [choice] } }) : { error: `status ${first.status}: ${first.text.slice(0, 300)}` };
    if (!firstParsed.edit) {
      results.push({ label: `${label}#${index + 1}`, modelKey, error: `turn 1: ${firstParsed.error}`, usage: first.json?.usage });
      continue;
    }
    const applied1 = applyEdit(firstParsed.edit, facts, draft);
    const evaluation1 = evaluatePlan(applied1.plan, facts, view);
    if (!evaluateRounds) {
      results.push({ label: `${label}#${index + 1}`, modelKey, turn1: { edit: firstParsed.edit, plan: applied1.plan, missingDraftGroups: applied1.missingDraftGroups, evaluation: evaluation1, reasoningChars: firstParsed.reasoningChars }, turn2: { skipped: true }, finalPlan: applied1.plan, usage: { turn1Shared: first.json?.usage } });
      continue;
    }
    const second = await chat(runId, {
      model: models[modelKey],
      messages: [...messages, { role: 'assistant', content: choice.message.content }, { role: 'user', content: editEvaluationText(evaluation1, applied1) }],
      ...sampling,
    });
    const secondParsed = parseEdit(second);
    const applied2 = secondParsed.edit ? applyEdit(secondParsed.edit, facts, draft) : null;
    results.push({
      label: `${label}#${index + 1}`,
      modelKey,
      turn1: { edit: firstParsed.edit, plan: applied1.plan, missingDraftGroups: applied1.missingDraftGroups, evaluation: evaluation1, reasoningChars: firstParsed.reasoningChars },
      turn2: applied2 ? { edit: secondParsed.edit, plan: applied2.plan, missingDraftGroups: applied2.missingDraftGroups, evaluation: evaluatePlan(applied2.plan, facts, view), reasoningChars: secondParsed.reasoningChars } : { error: secondParsed.error },
      finalPlan: applied2?.plan ?? applied1.plan,
      usage: { turn1Shared: first.json?.usage, turn2: second.json?.usage },
    });
  }
  return { facts, results };
}

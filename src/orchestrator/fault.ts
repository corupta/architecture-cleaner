// --inject-fault <step>:<operator>: the demo's seeded wrong move. The step's first committed attempt is replaced
// by one mutant of a mutation operator (src/mutation), built from the step's parent..commit exactly as the harness
// builds them, so its certificate FAILs and the agent loop has to roll back and replan.
import { createHash } from 'node:crypto';
import type { Profile } from '../certificate/profile.js';
import { commitEdits } from '../mutation/harness.js';
import { operators } from '../mutation/operators.js';
import { openSubject } from '../mutation/subject.js';

export interface FaultInput {
  repo: string;
  environment: string;
  packageRoot: string;
  profile: Profile | null;
  parent: string;
  commit: string;
  operator: string;
  message: string;
  workDir: string;
}

export const operatorIds = () => operators.map((operator) => operator.id);

/** The mutant commit (on top of `parent`, not checked out), or why the operator has no instance on this step. */
export function buildFault(input: FaultInput): { mutant: string; description: string } | { notApplied: string } {
  const operator = operators.find((candidate) => candidate.id === input.operator);
  if (!operator) return { notApplied: `no mutation operator ${input.operator} (known: ${operatorIds().join(', ')})` };
  const subject = openSubject({
    name: 'ac-run-fault',
    target: 'run',
    packageRoot: input.packageRoot,
    profile: input.profile,
    prepare: () => ({ repo: input.repo, environment: input.environment, base: input.parent, head: input.commit }),
  }, input.workDir);
  const rank = (key: string) => createHash('sha256').update(key).digest('hex');
  const candidates = operator.candidates(subject).sort((a, b) => rank(a.key).localeCompare(rank(b.key)));
  for (const candidate of candidates) {
    const edits = candidate.build();
    if (!edits?.size) continue;
    return { mutant: commitEdits(input.repo, input.commit, input.parent, edits, input.message), description: `${operator.id} (${operator.title}): ${candidate.description}` };
  }
  return { notApplied: `${operator.id} has no instance on this step (${candidates.length} candidates, none buildable)` };
}

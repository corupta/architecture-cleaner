// The demo's subject: immich server/ at the commit the recorded S6 run started from, the cassette holding that run's
// Nemotron calls (the Ultra plan edit and critic review, the Lightning findings narration), and the recorded run
// directory (runs/immich-ladder) that every re-executed result is compared with.
import path from 'node:path';
import { packageDirectory } from '../certificate/toolchain.js';

export interface DemoTarget {
  name: string;
  /** Where the commit is fetched from when no local clone is given. */
  url: string;
  /** The commit the recorded run started from (its plan's sha). */
  sha: string;
  /** A profile name (profiles/<name>.json) or file. */
  profile: string;
  /** The recorded Nemotron calls: the plan's, then the findings narration's. */
  cassette: string;
  /** The recorded run directory (src/orchestrator/types.ts). */
  recordedRun: string;
}

export function immichDemo(): DemoTarget {
  return {
    name: 'immich',
    url: 'https://github.com/immich-app/immich.git',
    sha: '02063972e82b1bfd17b6fc2e3b3ff39936229ea5',
    profile: 'immich',
    cassette: path.join(packageDirectory(), 'cassettes', 's6-immich.jsonl'),
    recordedRun: path.join(packageDirectory(), 'runs', 'immich-ladder'),
  };
}

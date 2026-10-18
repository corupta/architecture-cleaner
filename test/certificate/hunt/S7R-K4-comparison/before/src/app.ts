import { relative } from 'node:path';

// The legacy pipeline handles one file differently: a computed path compared with its repo path.
export const isLegacy = (file: string) => relative(process.cwd(), file) === 'src/services/legacy.service.ts';

export function pipelineOf(file: string): string {
  switch (relative(process.cwd(), file)) {
    case 'src/services/user.service.ts':
      return 'users';
    default:
      return isLegacy(file) ? 'legacy' : 'default';
  }
}

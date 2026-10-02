import { joinPath } from './shared/join-path';

export const templatesDirectory = joinPath(__dirname, 'templates');

export function templatePath(name: string): string {
  return joinPath(templatesDirectory, `${name}.html`);
}

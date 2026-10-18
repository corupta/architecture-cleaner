declare const process: { cwd(): string };
declare module 'node:path' { export function relative(from: string, to: string): string; }

declare const __dirname: string;
declare module 'node:path' { export function join(...parts: string[]): string; }
declare module 'node:child_process' { export function fork(modulePath: string): { on(event: 'exit', listener: (code: number) => void): void }; }

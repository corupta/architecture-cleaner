declare global { interface ImportMeta { resolve(specifier: string): string } }
export const workerUrl: string = import.meta.resolve('./worker.ts');
console.log(workerUrl);

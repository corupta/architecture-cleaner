import { readFileSync } from 'node:fs';
const meta = import.meta;
export const read = () => readFileSync(new URL('../data/config.txt', meta.url), 'utf8').trim();

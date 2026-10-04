import { readFileSync } from 'node:fs';
const { url } = import.meta;
export const read = () => readFileSync(new URL('../data/config.txt', url), 'utf8').trim();

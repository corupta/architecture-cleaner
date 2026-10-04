import { readFileSync } from 'node:fs';
export const read = () => readFileSync(new URL('../data/config.txt', import.meta['url']), 'utf8').trim();

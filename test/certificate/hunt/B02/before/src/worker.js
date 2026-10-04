import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
console.log(existsSync(fileURLToPath(import.meta.resolve('./task.js'))), existsSync(fileURLToPath(new URL('./task.js', import.meta.url))));

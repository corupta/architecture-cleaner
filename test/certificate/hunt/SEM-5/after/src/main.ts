import { join } from 'node:path';
import { fork } from 'node:child_process';
fork(join(__dirname, 'worker.js')).on('exit', (code) => console.log('worker exit ' + code));

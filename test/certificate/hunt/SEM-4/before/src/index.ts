import { listUsers } from './users/users.service';
declare const console: { log(text: string): void };
console.log(listUsers().join(','));

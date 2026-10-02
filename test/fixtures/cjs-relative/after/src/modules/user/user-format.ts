import type { User } from './user.model';
import { log } from '../../lib/logger';

export function formatName(name: string): string {
  return name.trim();
}

export function formatUser(user: User): string {
  log('format ' + user.id);
  return user.name + ' <' + user.role + '>';
}

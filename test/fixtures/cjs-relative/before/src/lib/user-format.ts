import type { User } from '../models/user.model';
import { log } from './logger';

export function formatName(name: string): string {
  return name.trim();
}

export function formatUser(user: User): string {
  log('format ' + user.id);
  return user.name + ' <' + user.role + '>';
}

import type { User } from './user.model';
import config = require('../../config.json');

export type { User as ValidatedUser } from './user.model';

export function isValidUser(user: User): boolean {
  return user.name.length > 0 && user.name.length <= config.maxNameLength;
}

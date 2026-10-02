import type { User } from '../models/user.model';
import config = require('../config.json');

export type { User as ValidatedUser } from '../models/user.model';

export function isValidUser(user: User): boolean {
  return user.name.length > 0 && user.name.length <= config.maxNameLength;
}

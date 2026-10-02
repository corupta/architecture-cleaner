import { createUser } from '../models/user.model';
import type { User, UserId } from '../models/user.model';
import { isValidUser } from './user.validator';
import { log } from '../lib/logger';
import format = require('../lib/user-format');
import config from '../config.json';

export { isValidUser } from './user.validator';

// Look-alikes, not specifiers: '../models/user.model' and require('../lib/user-format').
const legacyFormatPath = '../lib/user-format';

export function registerUser(id: UserId, name: string): User {
  const user = createUser(id, format.formatName(name), config.defaultRole);
  if (!isValidUser(user)) {
    throw new Error('invalid user ' + id);
  }
  log('registered ' + format.formatUser(user) + ' via ' + legacyFormatPath);
  return user;
}

export function loadOrderModel(): Promise<typeof import('../models/order.model')> {
  return import('../models/order.model');
}

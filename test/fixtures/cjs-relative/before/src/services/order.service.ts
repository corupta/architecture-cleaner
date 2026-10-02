import { createOrder, Order } from '../models/order.model';
import type { User } from '../models/user.model';
import { log } from '../lib/logger';

const format = require('../lib/user-format') as typeof import('../lib/user-format');

export const userServicePath: string = require.resolve('./user.service');

export function placeOrder(user: User, total: number): Order {
  const order = createOrder(user.id + '-' + user.orders.length, user.id, total);
  user.orders.push(order);
  log('order for ' + format.formatUser(user));
  return order;
}

export function loadUserService(): Promise<typeof import('./user.service')> {
  return import(`./user.service`);
}

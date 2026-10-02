import { createOrder, Order } from '../models/order.model';
import type { User } from '../modules/user/user.model';
import { log } from '../lib/logger';

const format = require('../modules/user/user-format') as typeof import('../modules/user/user-format');

export const userServicePath: string = require.resolve('../modules/user/user.service');

export function placeOrder(user: User, total: number): Order {
  const order = createOrder(user.id + '-' + user.orders.length, user.id, total);
  user.orders.push(order);
  log('order for ' + format.formatUser(user));
  return order;
}

export function loadUserService(): Promise<typeof import('../modules/user/user.service')> {
  return import(`../modules/user/user.service`);
}

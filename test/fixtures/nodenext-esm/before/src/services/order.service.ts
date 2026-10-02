import { now } from './clock.mjs';
import { formatMoney, type Money } from './format.js';
import type { User } from '../users/index.js';

export type { Money } from './format.js';

export interface Order {
  readonly customer: User;
  readonly total: Money;
  readonly placedAt: Date;
}

export function placeOrder(customer: User, total: Money): Order {
  return { customer, total, placedAt: now() };
}

export function describeOrder(order: Order): string {
  return `${order.customer.name}: ${formatMoney(order.total)}`;
}

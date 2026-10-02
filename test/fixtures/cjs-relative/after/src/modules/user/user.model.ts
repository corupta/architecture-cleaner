import type { Order } from '../../models/order.model';

export interface User {
  id: string;
  name: string;
  role: string;
  orders: Order[];
}

export type UserId = User['id'];

export function createUser(id: UserId, name: string, role: string): User {
  return { id, name, role, orders: [] };
}

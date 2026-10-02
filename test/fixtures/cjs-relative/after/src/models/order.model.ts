import type { UserId } from '../modules/user/user.model';

export interface Order {
  id: string;
  userId: UserId;
  total: number;
}

export function createOrder(id: string, userId: UserId, total: number): Order {
  return { id, userId, total };
}

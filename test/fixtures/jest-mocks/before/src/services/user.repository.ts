import type { User } from '../models/user.model';

export function findUser(id: number): User | undefined {
  return id === 1 ? { id, email: 'ada@example.com' } : undefined;
}

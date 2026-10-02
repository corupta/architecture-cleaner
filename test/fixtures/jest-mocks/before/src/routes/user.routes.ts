import { greetUser } from '../services/user.service';

export function getUserRoute(id: number): string {
  return greetUser(id);
}

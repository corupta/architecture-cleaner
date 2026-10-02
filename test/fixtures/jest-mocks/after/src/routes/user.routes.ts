import { greetUser } from '../modules/user/user.service';

export function getUserRoute(id: number): string {
  return greetUser(id);
}

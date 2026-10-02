import type { User } from "./user.model.js";
import type { UserId } from "../../shared/ids.js";

const usersById = new Map<UserId, User>();

export function saveUser(user: User): void {
  usersById.set(user.id, user);
}

export function findUser(id: UserId): User | undefined {
  return usersById.get(id);
}

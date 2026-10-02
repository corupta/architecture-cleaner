import { appConfig } from "../../config";
import { createUser, type User } from "./user.model";
import { slugify } from "@shared/strings";

export class UserService {
  private readonly users = new Map<string, User>();

  register(name: string): User {
    const user = createUser(name.slice(0, appConfig.maxNameLength));
    this.users.set(user.id, user);
    return user;
  }

  findBySlug(name: string): User | undefined {
    const slug = slugify(name);
    for (const user of this.users.values()) {
      if (user.slug === slug) {
        return user;
      }
    }
    return undefined;
  }
}

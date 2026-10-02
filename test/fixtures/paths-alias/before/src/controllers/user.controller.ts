import { appConfig } from "src/config";
import type { User } from "src/models/user.model";
import { UserService } from "@app/services/user.service";
import { newId } from "@app/shared/ids";
import { slugify } from "@shared/strings";

export interface CreateUserResponse {
  requestId: string;
  user: User;
}

export class UserController {
  constructor(private readonly service: UserService) {}

  create(body: { name: string }): CreateUserResponse {
    return { requestId: newId("req"), user: this.service.register(body.name) };
  }

  show(name: string): User | undefined {
    if (slugify(name) === "") {
      return undefined;
    }
    return this.service.findBySlug(name);
  }

  locale(): string {
    return appConfig.defaultLocale;
  }
}

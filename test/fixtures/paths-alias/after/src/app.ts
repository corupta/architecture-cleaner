import { UserController, userRoutes } from "./modules/user";
import { UserService } from "./modules/user/user.service";

export function buildApp(): { controller: UserController; routeCount: number } {
  const controller = new UserController(new UserService());
  return { controller, routeCount: userRoutes.length };
}

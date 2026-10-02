import { UserController, userRoutes } from "./users";
import { UserService } from "./services/user.service";

export function buildApp(): { controller: UserController; routeCount: number } {
  const controller = new UserController(new UserService());
  return { controller, routeCount: userRoutes.length };
}

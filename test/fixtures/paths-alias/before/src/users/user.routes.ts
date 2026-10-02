import type { UserController } from "../controllers/user.controller";

export interface Route {
  method: "GET" | "POST";
  path: string;
  handle(controller: UserController, input: string): unknown;
}

export const userRoutes: Route[] = [
  {
    method: "POST",
    path: "/users",
    handle: (controller, input) => controller.create({ name: input }),
  },
  {
    method: "GET",
    path: "/users/:slug",
    handle: (controller, input) => controller.show(input),
  },
];

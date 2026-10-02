import { registerUser } from "./modules/user/user.service";
import { placeOrder } from "./services/order.service";
import { log } from "./lib/logger";
import config from "./config.json";

export function loadFormatter(): Promise<typeof import("./modules/user/user-format")> {
  return import("./modules/user/user-format");
}

export function main(): void {
  const user = registerUser("u1", " Ada ");
  placeOrder(user, 42);
  log("default role " + config.defaultRole);
}

if (require.main === module) {
  main();
}

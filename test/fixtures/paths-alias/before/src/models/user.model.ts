import { appConfig } from "@app/config";
import { newId } from "@shared/ids";
import { slugify } from "@shared/strings";

export interface User {
  id: string;
  name: string;
  slug: string;
  locale: string;
}

export function createUser(name: string): User {
  return { id: newId("user"), name, slug: slugify(name), locale: appConfig.defaultLocale };
}

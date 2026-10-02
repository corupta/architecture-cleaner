/// <reference path="./types/globals.d.ts" />
/// <reference lib="es2020" />
import { renderWidget } from 'legacy-widget';
import { Settings } from './config/settings';
import { User } from './models/user.model';

declare module './config/settings' {
  interface Settings {
    locale?: string;
  }
}

export function describeUser(user: User, settings: Settings): string {
  const label = user.nickname ?? user.name;
  const theme = settings.theme ?? 'default';
  const locale = settings.locale ?? 'en';
  return renderWidget(`${label} [${theme}/${locale}] v${APP_VERSION}`);
}

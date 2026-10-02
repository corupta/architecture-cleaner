import type { Mail } from '../mailer';

export function sendMail(mail: Mail): string {
  return `mock-sent:${mail.to}`;
}

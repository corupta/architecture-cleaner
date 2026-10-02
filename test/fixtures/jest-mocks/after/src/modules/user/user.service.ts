import type { User } from '../../models/user.model';
import { now } from '@/lib/clock';
import { sendMail } from '../../lib/mailer';
import { findUser } from './user.repository';

export function greetUser(id: number): string {
  const user: User | undefined = findUser(id);
  if (!user) {
    return 'unknown user';
  }
  return sendMail({ to: user.email, subject: `hello at ${now()}` });
}

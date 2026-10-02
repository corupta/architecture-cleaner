import { findUser } from './user.service';
import { listUsers } from './users/user.service';

export const firstUser = findUser(listUsers()[0] ?? 'anonymous');

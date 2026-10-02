import type { User } from '../../models/user.model';
import type * as UserRepository from '../user.repository';

export const findUser: typeof UserRepository.findUser = (id: number): User | undefined => ({
  id,
  email: 'mock@example.com',
});

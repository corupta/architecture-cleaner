import { toUserId } from '../../shared/index.js'
import { findUser, saveUser } from './user.repository.js'
import type { User } from './user.model.js'

export function registerUser(rawId: string, name: string): User {
  const user: User = { id: toUserId(rawId), name }
  saveUser(user)
  return user
}

export function getUser(rawId: string): User | undefined {
  return findUser(toUserId(rawId))
}

import type { UserId } from '../shared/index.js';

export interface User {
  readonly id: UserId;
  readonly name: string;
}

// K6 Test inventory (plan §3.4). Placeholder until implemented.
import { type Check, skipped } from './types.js';

export const testInventory: Check = {
  id: 'K6',
  title: 'Test inventory',
  run: () => skipped('K6', 'Test inventory', 'not implemented yet'),
};

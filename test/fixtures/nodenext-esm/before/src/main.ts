import {
  describeOrder,
  placeOrder,
} from './services/order.service.js';
import { registerUser } from './users/index.js';
import type { User } from './users/user.model.js';
import { toUserId } from './shared/index.js';

// Reports are loaded lazily from './services/report.service.js'.
export const reportModuleHint = './services/report.service.js';

export async function run(): Promise<string[]> {
  const ada: User = registerUser('u-1', 'Ada');
  const order = placeOrder(ada, { cents: 1250 });
  const { buildReport } = await import('./services/report.service.js');
  const lines = await buildReport([order]);
  return [describeOrder(order), ...lines, toUserId('guest')];
}

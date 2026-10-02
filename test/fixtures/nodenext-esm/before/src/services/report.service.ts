import type { Order } from './order.service.js';

export async function buildReport(orders: readonly Order[]): Promise<string[]> {
  const { formatMoney } = await import(`./format.js`);
  const { getUser } = await import('../users/index.js');
  return orders.map((order) => {
    const status = getUser(order.customer.id) === undefined ? 'unknown' : 'known';
    return `${status} ${formatMoney(order.total)}`;
  });
}

import type { ChargeResult } from '../platform/payment.gateway';
import { taxFor } from './tax.calculator';

export async function refundCharge(result: ChargeResult): Promise<number> {
  const { refund } = await import(`../platform/payment.gateway`);
  const accepted = await refund(result.id);
  return accepted ? result.amount - taxFor(result.amount) : 0;
}

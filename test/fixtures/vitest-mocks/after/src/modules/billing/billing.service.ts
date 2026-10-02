import { now } from '@/lib/clock';
import { charge, type ChargeResult } from '../../platform/payment.gateway';
import { taxFor } from '../../services/tax.calculator';

export interface Invoice {
  customerId: string;
  net: number;
  tax: number;
  issuedAt: Date;
  charge: ChargeResult;
}

export async function issueInvoice(customerId: string, net: number): Promise<Invoice> {
  const tax = taxFor(net);
  const result = await charge(customerId, net + tax);
  return { customerId, net, tax, issuedAt: now(), charge: result };
}

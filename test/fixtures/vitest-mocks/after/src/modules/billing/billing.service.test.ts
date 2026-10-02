import { issueInvoice } from './billing.service';
import { charge } from '../../platform/payment.gateway';
import { now } from '@/lib/clock';

vi.mock('../../services/tax.calculator', async () => {
  const actual = await vi.importActual<typeof import('../../services/tax.calculator')>('../../services/tax.calculator');
  return { ...actual, taxFor: vi.fn(() => 0) };
});
vi.mock('@/lib/clock');
vi.mock(import('../../platform/payment.gateway'));

describe('issueInvoice', () => {
  it('charges the net amount when tax is mocked to zero', async () => {
    const invoice = await issueInvoice('customer-1', 100);
    expect(invoice.tax).toBe(0);
    expect(charge).toHaveBeenCalledWith('customer-1', 100);
    expect(now).toHaveBeenCalled();
  });
});

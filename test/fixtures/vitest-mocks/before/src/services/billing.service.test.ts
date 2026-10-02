import { issueInvoice } from './billing.service';
import { charge } from './payment.gateway';
import { now } from '@/lib/clock';

vi.mock('./tax.calculator', async () => {
  const actual = await vi.importActual<typeof import('./tax.calculator')>('./tax.calculator');
  return { ...actual, taxFor: vi.fn(() => 0) };
});
vi.mock('@/lib/clock');
vi.mock(import('./payment.gateway'));

describe('issueInvoice', () => {
  it('charges the net amount when tax is mocked to zero', async () => {
    const invoice = await issueInvoice('customer-1', 100);
    expect(invoice.tax).toBe(0);
    expect(charge).toHaveBeenCalledWith('customer-1', 100);
    expect(now).toHaveBeenCalled();
  });
});

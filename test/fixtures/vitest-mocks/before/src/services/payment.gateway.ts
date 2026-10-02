export interface ChargeResult {
  id: string;
  amount: number;
}

export async function charge(customerId: string, amount: number): Promise<ChargeResult> {
  return { id: customerId + ':' + String(amount), amount };
}

export async function refund(chargeId: string): Promise<boolean> {
  return chargeId.length > 0;
}

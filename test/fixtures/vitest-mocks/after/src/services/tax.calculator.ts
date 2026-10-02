export const TAX_RATE = 0.2;

export function taxFor(amount: number): number {
  return Math.round(amount * TAX_RATE * 100) / 100;
}

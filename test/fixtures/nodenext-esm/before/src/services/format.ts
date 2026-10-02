export type Money = { readonly cents: number };

export function formatMoney(money: Money): string {
  return `$${(money.cents / 100).toFixed(2)}`;
}

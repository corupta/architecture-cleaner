export type UserId = string & { readonly brand: 'UserId' };

export function toUserId(raw: string): UserId {
  return raw as UserId;
}

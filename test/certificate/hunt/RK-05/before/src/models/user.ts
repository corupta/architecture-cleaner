export interface User { name: string }
export const makeUser = (name: string): User => ({ name } as User);

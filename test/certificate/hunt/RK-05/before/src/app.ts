import { makeUser } from '@app/models/user';
import './augment/user-extra';
export const extra: string | undefined = makeUser('a').extra;

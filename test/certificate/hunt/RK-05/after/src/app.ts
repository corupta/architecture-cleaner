import { makeUser } from '@app/modules/user/user';
import './augment/user-extra';
export const extra: string | undefined = makeUser('a').extra;

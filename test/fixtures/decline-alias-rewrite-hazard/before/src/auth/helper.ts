import { isDefined } from 'src/utils';

export const hasProvider = (provider: string | undefined) => isDefined(provider);

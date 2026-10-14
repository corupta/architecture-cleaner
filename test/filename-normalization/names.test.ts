// R3 names: only casing and separators change; the stem and the role word are kept.
import { describe, expect, it } from 'vitest';
import { normalizedName } from '../../src/filename-normalization/names.js';

const renamed = (basename: string) => {
  const result = normalizedName(basename);
  return result.kind === 'rename' ? result.basename : result.kind;
};

describe('normalizedName', () => {
  it.each([
    ['userController.ts', 'user.controller.ts'],
    ['view-repository.ts', 'view.repository.ts'],
    ['user_service.ts', 'user.service.ts'],
    ['UserService.ts', 'user.service.ts'],
    ['sharedLinkController.spec.ts', 'shared-link.controller.spec.ts'],
    ['shared_link-service.e2e-spec.ts', 'shared-link.service.e2e-spec.ts'],
    ['userAdmin.service.ts', 'user-admin.service.ts'],
    ['HTTPClientFactory.ts', 'http-client.factory.ts'],
    ['mediaUtils.ts', 'media.utils.ts'],
    ['orderDAO.ts', 'order.dao.ts'],
    ['auth2Guard.tsx', 'auth2.guard.tsx'],
    ['api-key-dto.mts', 'api-key.dto.mts'],
  ])('%s -> %s', (from, to) => expect(renamed(from)).toBe(to));

  it.each(['user.controller.ts', 'api-key.repository.ts', 'user.admin.service.ts', 'auth.guard.spec.ts', 'shared-link.dto.ts'])('leaves the normal %s alone', (name) => {
    expect(renamed(name)).toBe('normal');
  });

  it.each(['index.ts', 'types.ts', 'grant-admin.ts', 'storage.core.ts', 'user.d.ts', 'README.md', 'service.ts', 'logo.svg'])('leaves %s without a role word alone', (name) => {
    expect(renamed(name)).toBe('no-role');
  });

  it.each(['OAuthService.ts', 'user$Service.ts', 'user..service.ts', '2FAService.ts'])('reports %s as unparseable', (name) => {
    expect(renamed(name)).toBe('unparseable');
  });

  it('turns a case-only difference into a rename the caller must refuse', () => {
    expect(renamed('User.service.ts')).toBe('user.service.ts');
  });
});

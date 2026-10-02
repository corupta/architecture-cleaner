import { greetUser } from './user.service';

jest.mock('./user.repository');
jest.mock('@/lib/mailer');
jest.mock('../../lib/clock', () => ({ now: () => 0 }));
jest.mock('./does-not-exist', () => ({}), { virtual: true });

const actualRepository = jest.requireActual<{ findUser(id: number): unknown }>('./user.repository');

describe('greetUser', () => {
  it('uses the manual repository mock', () => {
    expect(greetUser(5)).toMatchSnapshot();
  });

  it('keeps the real repository reachable', () => {
    expect(actualRepository.findUser(2)).toBe(undefined);
  });
});

import { greet } from '../src/greeting';

describe('greet', () => {
  it('greets', () => {
    expect(greet('ada')).toBe('hello ada');
  });
});

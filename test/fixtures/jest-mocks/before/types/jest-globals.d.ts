declare const jest: {
  mock(path: string, factory?: () => unknown, options?: { virtual?: boolean }): void;
  doMock(path: string, factory?: () => unknown, options?: { virtual?: boolean }): void;
  unmock(path: string): void;
  requireActual<T = unknown>(path: string): T;
  requireMock<T = unknown>(path: string): T;
};

declare function describe(name: string, body: () => void): void;
declare function it(name: string, body: () => void): void;
declare function expect(actual: unknown): {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toMatchSnapshot(): void;
};

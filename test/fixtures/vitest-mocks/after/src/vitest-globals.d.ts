declare const vi: {
  mock(path: string | Promise<unknown>, factory?: () => unknown): void;
  importActual<T = unknown>(path: string): Promise<T>;
  importMock<T = unknown>(path: string): Promise<T>;
  fn<T extends (...args: never[]) => unknown>(implementation?: T): T;
};

declare function describe(name: string, body: () => void): void;

declare function it(name: string, body: () => void | Promise<void>): void;

declare function expect(actual: unknown): {
  toBe(expected: unknown): void;
  toHaveBeenCalled(): void;
  toHaveBeenCalledWith(...args: unknown[]): void;
};

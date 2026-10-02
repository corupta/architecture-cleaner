declare function describe(name: string, body: () => void): void;
declare function it(name: string, body: () => void | Promise<void>): void;
declare function expect(actual: unknown): { toBe(expected: unknown): void };

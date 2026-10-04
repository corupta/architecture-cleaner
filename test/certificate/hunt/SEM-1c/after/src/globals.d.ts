declare function test(name: string, fn: () => void): void;
declare function expect(value: unknown): { toBe(expected: unknown): void };

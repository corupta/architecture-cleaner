declare function test(name: string, body: () => void): void;
declare function expect(value: unknown): { toBe(expected: unknown): void };

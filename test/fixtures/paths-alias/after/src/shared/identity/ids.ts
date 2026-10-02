let counter = 0;

export function newId(prefix: string): string {
  counter += 1;
  return prefix + "_" + String(counter);
}

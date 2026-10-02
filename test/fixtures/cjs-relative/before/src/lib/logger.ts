const lines: string[] = [];

export function log(message: string): void {
  lines.push(message);
}

export function flush(): string[] {
  return lines.splice(0, lines.length);
}

export let frozenNow: number | undefined;

export function freezeClock(timestamp: number): void {
  frozenNow = timestamp;
}

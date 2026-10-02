export function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

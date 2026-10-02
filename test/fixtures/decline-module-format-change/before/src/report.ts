import { formatDate } from './format-date';

export function reportHeader(timestamp: number): string {
  return `Report for ${formatDate(timestamp)}`;
}

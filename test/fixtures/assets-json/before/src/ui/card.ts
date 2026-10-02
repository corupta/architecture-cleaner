import './button.css';
import { button } from './button';

export function card(title: string): string {
  return '<div class="card">' + button({ label: title }) + '</div>';
}

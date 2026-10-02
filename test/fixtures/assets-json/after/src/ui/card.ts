import './button.css';
import { button } from '../modules/ui/button';

export function card(title: string): string {
  return '<div class="card">' + button({ label: title }) + '</div>';
}

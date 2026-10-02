import theme from './theme.json';
import logo from '../assets/logo.svg';
import { button } from './modules/ui/button';
import { card } from './ui/card';
import { logoIcon } from './modules/ui/icons';

export function render(): string {
  return '<main data-radius="' + theme.radius + '" data-logo="' + logo + '">' + card('Welcome') + button(logoIcon) + '</main>';
}

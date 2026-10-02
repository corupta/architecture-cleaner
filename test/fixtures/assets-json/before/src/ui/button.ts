import './button.css';
import theme from '../theme.json';

export interface ButtonProps {
  label: string;
  icon?: string;
}

export function button(props: ButtonProps): string {
  const icon = props.icon ? '<img src="' + props.icon + '">' : '';
  return '<button style="color:' + theme.primary + ';border-radius:' + theme.radius + 'px">' + icon + props.label + '</button>';
}

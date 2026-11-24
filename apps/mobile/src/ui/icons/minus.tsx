import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const MinusIcon: IconComponent = (props) =>
  drawIcon({ d: 'M5 12h14', filled: false }, props);

import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const CheckIcon: IconComponent = (props) =>
  drawIcon({ d: 'M5 12.500 10 17.500 19 7', filled: false }, props);

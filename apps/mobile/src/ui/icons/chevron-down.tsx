import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const ChevronDownIcon: IconComponent = (props) =>
  drawIcon({ d: 'M5 9l7 7 7-7', filled: false }, props);

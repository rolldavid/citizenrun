import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const ChevronRightIcon: IconComponent = (props) =>
  drawIcon({ d: 'M9 5l7 7-7 7', filled: false }, props);

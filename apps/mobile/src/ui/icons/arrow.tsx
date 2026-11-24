import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const ArrowIcon: IconComponent = (props) =>
  drawIcon({ d: 'M5 12h14M13 6l6 6-6 6', filled: false }, props);

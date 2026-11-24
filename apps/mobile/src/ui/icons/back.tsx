import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const BackIcon: IconComponent = (props) =>
  drawIcon({ d: 'M14 5l-7 7 7 7', filled: false }, props);

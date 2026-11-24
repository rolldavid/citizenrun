import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const CloseIcon: IconComponent = (props) =>
  drawIcon({ d: 'M6 6l12 12M18 6 6 18', filled: false }, props);

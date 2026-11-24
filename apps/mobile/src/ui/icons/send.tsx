import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const SendIcon: IconComponent = (props) =>
  drawIcon({ d: 'M12 20V5M6 11l6-6 6 6', filled: false }, props);

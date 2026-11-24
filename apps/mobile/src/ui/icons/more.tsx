import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const MoreIcon: IconComponent = (props) =>
  drawIcon({ d: 'M5 12h.01M12 12h.01M19 12h.01', filled: false, strokeWidth: 2.6 }, props);

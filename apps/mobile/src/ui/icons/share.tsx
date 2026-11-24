import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const ShareIcon: IconComponent = (props) =>
  drawIcon({ d: 'M12 15V4M8 8l4-4 4 4M5 12v8h14v-8', filled: false }, props);

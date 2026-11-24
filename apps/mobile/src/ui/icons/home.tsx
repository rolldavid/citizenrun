import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const HomeIcon: IconComponent = (props) =>
  drawIcon({ d: 'M4 11 12 4l8 7v9H4z', filled: false }, props);

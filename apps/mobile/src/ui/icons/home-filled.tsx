import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const HomeFilledIcon: IconComponent = (props) =>
  drawIcon({ d: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z', filled: true }, props);

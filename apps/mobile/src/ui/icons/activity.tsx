import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const ActivityIcon: IconComponent = (props) =>
  drawIcon({ d: 'M6 17v-6a6 6 0 0 1 12 0v6zM4 17h16M10.500 20.500h3', filled: false }, props);

import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const RepostIcon: IconComponent = (props) =>
  drawIcon({ d: 'M7 7h10v6M14 10l3 3 3-3M17 17H7v-6M10 14l-3-3-3 3', filled: false }, props);

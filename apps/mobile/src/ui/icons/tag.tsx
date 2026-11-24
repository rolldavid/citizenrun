import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const TagIcon: IconComponent = (props) =>
  drawIcon({ d: 'M4 4h8l8 8-8 8-8-8zM8.500 8.500v.010', filled: false }, props);

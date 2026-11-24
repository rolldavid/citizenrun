import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const TrashIcon: IconComponent = (props) =>
  drawIcon({ d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5', filled: false }, props);

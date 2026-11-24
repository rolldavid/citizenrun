import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const CalendarIcon: IconComponent = (props) =>
  drawIcon({ d: 'M4 6h16v14H4zM4 10h16M8 3.500v4M16 3.500v4', filled: false }, props);

import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const MessagesIcon: IconComponent = (props) =>
  drawIcon({ d: 'M3.500 6h17v12h-17zM3.500 6.500 12 13l8.500-6.500', filled: false }, props);

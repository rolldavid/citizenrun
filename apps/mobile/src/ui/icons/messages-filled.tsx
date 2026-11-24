import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const MessagesFilledIcon: IconComponent = (props) =>
  drawIcon({ d: 'M3.500 6h17v12h-17zM6.500 9 12 13.200 17.500 9z', filled: true }, props);

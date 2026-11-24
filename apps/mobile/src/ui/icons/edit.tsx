import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const EditIcon: IconComponent = (props) =>
  drawIcon({ d: 'M4 20h4L19.500 8.500l-4-4L4 16zM13.500 6.500l4 4', filled: false }, props);

import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const PlayFilledIcon: IconComponent = (props) =>
  drawIcon({ d: 'M7 4.500v15l12-7.500z', filled: true }, props);

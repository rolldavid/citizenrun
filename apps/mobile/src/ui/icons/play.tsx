import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const PlayIcon: IconComponent = (props) =>
  drawIcon({ d: 'M7 4.500v15l12-7.500z', filled: false }, props);

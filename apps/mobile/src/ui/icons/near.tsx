import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const NearIcon: IconComponent = (props) =>
  drawIcon({ d: 'M20 4 4 10.500l7 2.500 2.500 7z', filled: false }, props);

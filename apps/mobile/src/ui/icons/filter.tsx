import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const FilterIcon: IconComponent = (props) =>
  drawIcon({ d: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4.500v5M6 14.500v5', filled: false }, props);

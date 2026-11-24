import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const LayersIcon: IconComponent = (props) =>
  drawIcon(
    { d: 'M12 4l8.500 4.500L12 13 3.500 8.500zM3.500 13.500 12 18l8.500-4.500', filled: false },
    props,
  );

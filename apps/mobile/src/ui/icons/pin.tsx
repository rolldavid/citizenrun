import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const PinIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M12 21s-6.500-6-6.500-11a6.500 6.500 0 0 1 13 0c0 5-6.500 11-6.500 11zM12 8v4',
      filled: false,
    },
    props,
  );

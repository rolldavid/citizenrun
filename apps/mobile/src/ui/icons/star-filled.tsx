import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const StarFilledIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M12 3.500l2.600 5.600 6 .700-4.500 4.100 1.200 6-5.300-3-5.300 3 1.200-6L3.400 9.800l6-.700z',
      filled: true,
    },
    props,
  );

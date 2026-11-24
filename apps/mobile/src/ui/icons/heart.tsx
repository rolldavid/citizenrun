import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const HeartIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M12 20 4.500 12.500a4.600 4.600 0 0 1 6.500-6.500l1 1 1-1a4.600 4.600 0 0 1 6.500 6.500z',
      filled: false,
    },
    props,
  );

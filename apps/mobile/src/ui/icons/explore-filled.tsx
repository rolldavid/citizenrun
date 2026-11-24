import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const ExploreFilledIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M12 3.500a8.500 8.500 0 1 0 0 17 8.500 8.500 0 0 0 0-17zM16 8l-2.300 5.700L8 16l2.300-5.700z',
      filled: true,
    },
    props,
  );

import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const ExploreIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M12 3.500a8.500 8.500 0 1 0 0 17 8.500 8.500 0 0 0 0-17zM15.500 8.500l-2 5-5 2 2-5z',
      filled: false,
    },
    props,
  );

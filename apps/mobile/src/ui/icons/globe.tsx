import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const GlobeIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M12 3.500a8.500 8.500 0 1 0 0 17 8.500 8.500 0 0 0 0-17zM3.500 12h17M12 3.500c-3 3-3 14 0 17M12 3.500c3 3 3 14 0 17',
      filled: false,
    },
    props,
  );

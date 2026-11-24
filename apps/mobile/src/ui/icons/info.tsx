import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const InfoIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M12 3.500a8.500 8.500 0 1 0 0 17 8.500 8.500 0 0 0 0-17zM12 11v6M12 7.500v.010',
      filled: false,
    },
    props,
  );

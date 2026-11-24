import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const ErrorIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M12 3.500a8.500 8.500 0 1 0 0 17 8.500 8.500 0 0 0 0-17zM9 9l6 6M15 9l-6 6',
      filled: false,
    },
    props,
  );

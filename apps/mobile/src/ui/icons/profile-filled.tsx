import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const ProfileFilledIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M12 4.500a3.500 3.500 0 1 0 0 7 3.500 3.500 0 0 0 0-7zM5 20a7 7 0 0 1 14 0z',
      filled: true,
    },
    props,
  );

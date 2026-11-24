import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const BlockIcon: IconComponent = (props) =>
  drawIcon(
    { d: 'M12 3.500a8.500 8.500 0 1 0 0 17 8.500 8.500 0 0 0 0-17zM6 6l12 12', filled: false },
    props,
  );

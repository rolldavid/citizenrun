import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const LinkIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M10 14l4-4M9 7.500 11 5.500a3.900 3.900 0 0 1 5.500 0l2 2a3.900 3.900 0 0 1 0 5.500l-2 2M15 16.500l-2 2a3.900 3.900 0 0 1-5.500 0l-2-2a3.900 3.900 0 0 1 0-5.500l2-2',
      filled: false,
    },
    props,
  );

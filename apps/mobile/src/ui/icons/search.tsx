import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const SearchIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M11 4.500a6.500 6.500 0 1 0 0 13 6.500 6.500 0 0 0 0-13zM16 16l4.500 4.500',
      filled: false,
    },
    props,
  );

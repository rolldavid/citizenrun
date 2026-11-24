import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const SoundIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M4 9.500h3.500L12 6v12l-4.500-3.500H4zM15.500 9.500a3.500 3.500 0 0 1 0 5M18 7a7 7 0 0 1 0 10',
      filled: false,
    },
    props,
  );

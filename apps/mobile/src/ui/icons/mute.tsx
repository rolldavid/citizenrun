import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const MuteIcon: IconComponent = (props) =>
  drawIcon(
    { d: 'M4 9.500h3.500L12 6v12l-4.500-3.500H4zM16 9.500l4 5M20 9.500l-4 5', filled: false },
    props,
  );

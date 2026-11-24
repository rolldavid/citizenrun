import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const CameraIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M4 7.500h3.500L9 5h6l1.500 2.500H20V19H4zM12 10a3.250 3.250 0 1 0 0 6.500 3.250 3.250 0 0 0 0-6.500z',
      filled: false,
    },
    props,
  );

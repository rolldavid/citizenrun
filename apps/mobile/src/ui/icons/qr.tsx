import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const QrIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.500v2.500H14zM17.500 17.500H20V20h-2.500z',
      filled: false,
    },
    props,
  );

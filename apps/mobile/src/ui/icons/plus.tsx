import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const PlusIcon: IconComponent = (props) =>
  drawIcon({ d: 'M12 5v14M5 12h14', filled: false }, props);

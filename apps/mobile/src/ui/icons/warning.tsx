import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const WarningIcon: IconComponent = (props) =>
  drawIcon({ d: 'M12 4 21 20H3zM12 10v5M12 17.500v.010', filled: false }, props);

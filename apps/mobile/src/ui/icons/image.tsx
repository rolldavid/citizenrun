import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const ImageIcon: IconComponent = (props) =>
  drawIcon({ d: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.500v.010', filled: false }, props);

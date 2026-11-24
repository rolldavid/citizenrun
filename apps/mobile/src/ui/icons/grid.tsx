import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const GridIcon: IconComponent = (props) =>
  drawIcon({ d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', filled: false }, props);

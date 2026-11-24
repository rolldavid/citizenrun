import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const MapIcon: IconComponent = (props) =>
  drawIcon({ d: 'M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14', filled: false }, props);

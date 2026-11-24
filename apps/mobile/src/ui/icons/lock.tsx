import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const LockIcon: IconComponent = (props) =>
  drawIcon({ d: 'M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3', filled: false }, props);

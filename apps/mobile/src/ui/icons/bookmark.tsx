import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const BookmarkIcon: IconComponent = (props) =>
  drawIcon({ d: 'M7 4h10v16l-5-4-5 4z', filled: false }, props);

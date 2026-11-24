import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const CommentIcon: IconComponent = (props) =>
  drawIcon({ d: 'M4 5h16v11h-9l-4 4v-4H4z', filled: false }, props);

import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const ReportIcon: IconComponent = (props) =>
  drawIcon({ d: 'M5 21V4M5 4.500h13l-3 4.500 3 4.500H5', filled: false }, props);

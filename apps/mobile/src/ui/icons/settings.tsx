import { drawIcon } from './draw';
import type { IconComponent } from './draw';

export const SettingsIcon: IconComponent = (props) =>
  drawIcon(
    {
      d: 'M12 8.500a3.500 3.500 0 1 0 0 7 3.500 3.500 0 0 0 0-7zM12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.200 2.200M16.200 16.200l2.200 2.200M18.400 5.600l-2.200 2.200M7.800 16.200l-2.200 2.200',
      filled: false,
    },
    props,
  );

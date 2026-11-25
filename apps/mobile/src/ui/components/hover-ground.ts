import { createContext, useContext } from 'react';

/**
 * True where the ground is a hover or a pressed fill: C-ListRow sets it around its leading element
 * while the row is hovered or pressed, and C-IssueTile reads it. Internal to the design system.
 */
export const HoverGroundContext = createContext(false);

/** Whether the element stands on a hovered or pressed ground. */
export function useHoverGround(): boolean {
  return useContext(HoverGroundContext);
}

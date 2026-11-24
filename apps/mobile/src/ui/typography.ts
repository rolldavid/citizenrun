// Type roles as React Native styles. Lint rule citizenrun/tokens-only is off here.
import type { TextStyle } from 'react-native';
import { FONT_FILES, textScale, typeRoles } from '@citizenrun/shared';
import type { TypeRole } from '@citizenrun/shared';

export type TextRoleStyle = {
  style: TextStyle;
  /** Passed to the Text prop of the same name; undefined lets the role follow the system without limit. */
  maxFontSizeMultiplier: number | undefined;
};

const ROLES = Object.keys(typeRoles) as TypeRole[]; // Object.keys loses the key type

function build(role: TypeRole): TextRoleStyle {
  const spec = typeRoles[role];
  const base: TextStyle = {
    fontFamily: FONT_FILES[spec.face],
    fontSize: spec.size,
    lineHeight: spec.lineHeight,
    letterSpacing: spec.size * spec.tracking,
  };
  const style: TextStyle = spec.uppercase ? { ...base, textTransform: 'uppercase' } : base;
  return { style, maxFontSizeMultiplier: spec.capped ? textScale.maxLargeRoles : undefined };
}

export const typography = Object.fromEntries(ROLES.map((role) => [role, build(role)])) as Readonly<
  Record<TypeRole, TextRoleStyle>
>; // fromEntries loses the key type

/** Added to a role for numbers that change in place or sit in a column. */
export const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };

/** The style of a string its face cannot draw: the system font at the role's size and weight. */
export function systemFallback(role: TypeRole): TextStyle {
  const spec = typeRoles[role];
  const weight = spec.face === 'bold' ? '700' : spec.face === 'regular' ? '400' : '500';
  return { fontSize: spec.size, lineHeight: spec.lineHeight, fontWeight: weight };
}

export type { TypeRole } from '@citizenrun/shared';

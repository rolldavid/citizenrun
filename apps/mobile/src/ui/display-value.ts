import { isAbout } from '@citizenrun/shared';
import type { Sourced } from '@citizenrun/shared';

/** A value ready to draw. text null means "not known yet"; about means low confidence or an estimate (L-about). */
export type DisplayValue = { text: string | null; about: boolean };

/** Turns a sourced value into what a component draws; `format` runs only on a known value. */
export function toDisplayValue<T>(
  sourced: Sourced<T>,
  format: (value: T) => string,
  estimated?: boolean | null,
): DisplayValue {
  return {
    text: sourced.value === null ? null : format(sourced.value),
    about: isAbout(sourced.value, sourced.meta, estimated ?? null),
  };
}

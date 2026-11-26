import { OFFICE_TYPE_ILLUSTRATION } from '../generated/office-type-illustrations.ts';

// CARD-art-ids: an office type's drawing is named by its illustration id, from the generated table.

const ILLUSTRATIONS: Readonly<Record<string, string>> = OFFICE_TYPE_ILLUSTRATION;
const FALLBACK_ILLUSTRATION = 'city-council';

/** The illustration id of an office type; `city-council` for an id this build does not know. */
export function illustrationFor(officeTypeId: string): string {
  return Object.hasOwn(ILLUSTRATIONS, officeTypeId)
    ? (ILLUSTRATIONS[officeTypeId] ?? FALLBACK_ILLUSTRATION)
    : FALLBACK_ILLUSTRATION;
}

/** True when the office type is one of the generated table's; false for an id this build does not know. */
export function hasOfficeType(officeTypeId: string): boolean {
  return Object.hasOwn(ILLUSTRATIONS, officeTypeId);
}

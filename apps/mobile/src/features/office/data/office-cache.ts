import type { OfficeSummary } from '@citizenrun/shared';
import { getListOfficesInfiniteQueryKey, getListOfficesQueryKey } from '@citizenrun/shared/api';
import type { QueryFilters } from '@tanstack/react-query';

export type OfficeViewerPatch = Partial<Pick<OfficeSummary['viewer'], 'following' | 'bookmarked'>>;

// The office path the generated keys start with, and the marker the generated infinite keys put
// before it; read from the key functions, never written by hand.
const OFFICE_PATH = getListOfficesQueryKey()[0];
const INFINITE_MARKER = getListOfficesInfiniteQueryKey()[0];

function isOfficePath(value: unknown): boolean {
  return (
    typeof value === 'string' && (value === OFFICE_PATH || value.startsWith(`${OFFICE_PATH}/`))
  );
}

/** Every cached query whose key starts with the generated office path ('/v1/offices'): E-OFF-01 by id or slug, E-EXP-01 and its pages. */
export const OFFICE_CACHE_FILTERS: QueryFilters = {
  predicate: (query) => {
    const [first, second] = query.queryKey;
    return isOfficePath(first) || (first === INFINITE_MARKER && isOfficePath(second));
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An OfficeDetail or OfficeSummary of this id, with its viewer flags patched; else the same value. */
function patchOffice(value: unknown, officeId: string, patch: OfficeViewerPatch): unknown {
  if (!isRecord(value) || value.id !== officeId || !isRecord(value.viewer)) {
    return value;
  }
  return { ...value, viewer: { ...value.viewer, ...patch } };
}

/** A page of offices with its matching items patched; else the same value. */
function patchPage(value: unknown, officeId: string, patch: OfficeViewerPatch): unknown {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return value;
  }
  const items: unknown[] = value.items;
  const patched = items.map((item) => patchOffice(item, officeId, patch));
  return patched.some((item, index) => item !== items[index])
    ? { ...value, items: patched }
    : value;
}

/** Sets the viewer flags of the office with this id wherever it sits in a cached value; returns the same reference when nothing matched. */
export function patchOfficeViewer(
  data: unknown,
  officeId: string,
  patch: OfficeViewerPatch,
): unknown {
  if (!isRecord(data)) {
    return data;
  }
  if (data.id === officeId && isRecord(data.viewer)) {
    return patchOffice(data, officeId, patch);
  }
  if (Array.isArray(data.items)) {
    return patchPage(data, officeId, patch);
  }
  if (Array.isArray(data.pages)) {
    const pages: unknown[] = data.pages;
    const patched = pages.map((page) => patchPage(page, officeId, patch));
    return patched.some((page, index) => page !== pages[index])
      ? { ...data, pages: patched }
      : data;
  }
  return data;
}

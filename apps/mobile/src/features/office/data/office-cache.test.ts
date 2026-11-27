import type { CandidacyView, OfficeDetail, OfficeListPage } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { officeCandidates, officeReady } from '../view-models/office.fixtures';

import { patchOfficeViewer } from './office-cache';

function officeOf(vm: typeof officeReady): OfficeDetail {
  if (vm.status !== 'ready') throw new Error('expected a ready fixture');
  return vm.data.office;
}

const OFFICE = officeOf(officeReady);
const OTHER: OfficeDetail = {
  ...OFFICE,
  id: '01890000-0000-7000-8000-000000000199',
  slug: 'other',
};

function page(items: OfficeDetail[]): OfficeListPage {
  return { items, nextCursor: null, total: items.length };
}

describe('patchOfficeViewer', () => {
  it('patches a detail, a page and pages', () => {
    const detail = patchOfficeViewer(OFFICE, OFFICE.id, { following: true }) as OfficeDetail;
    expect(detail).not.toBe(OFFICE);
    expect(detail.viewer).toEqual({ ...OFFICE.viewer, following: true });
    expect(detail.title).toBe(OFFICE.title);

    const list = page([OTHER, OFFICE]);
    const patchedList = patchOfficeViewer(list, OFFICE.id, { bookmarked: true }) as OfficeListPage;
    expect(patchedList).not.toBe(list);
    expect(patchedList.items[0]).toBe(OTHER);
    expect(patchedList.items[1]?.viewer.bookmarked).toBe(true);
    expect(patchedList.items[1]?.viewer.following).toBe(false);

    const untouched = page([OTHER]);
    const pages = { pages: [untouched, page([OFFICE])], pageParams: [undefined, 'next'] };
    const patchedPages = patchOfficeViewer(pages, OFFICE.id, { following: true }) as typeof pages;
    expect(patchedPages).not.toBe(pages);
    expect(patchedPages.pageParams).toBe(pages.pageParams);
    expect(patchedPages.pages[0]).toBe(untouched);
    expect(patchedPages.pages[1]?.items[0]?.viewer.following).toBe(true);
  });

  it('returns the same reference when nothing matches', () => {
    expect(patchOfficeViewer(OTHER, OFFICE.id, { following: true })).toBe(OTHER);
    const list = page([OTHER]);
    expect(patchOfficeViewer(list, OFFICE.id, { following: true })).toBe(list);
    const pages = { pages: [list], pageParams: [undefined] };
    expect(patchOfficeViewer(pages, OFFICE.id, { following: true })).toBe(pages);
  });

  it('ignores other shapes', () => {
    expect(patchOfficeViewer(null, OFFICE.id, { following: true })).toBeNull();
    expect(patchOfficeViewer('office', OFFICE.id, { following: true })).toBe('office');
    expect(patchOfficeViewer(undefined, OFFICE.id, { following: true })).toBeUndefined();
    const candidates: { items: CandidacyView[]; nextCursor: string | null } = {
      items: officeOf(officeCandidates).candidates,
      nextCursor: null,
    };
    expect(patchOfficeViewer(candidates, OFFICE.id, { following: true })).toBe(candidates);
  });
});

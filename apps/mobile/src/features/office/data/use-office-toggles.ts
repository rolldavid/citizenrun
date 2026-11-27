import {
  bookmarkOffice,
  followOffice,
  unbookmarkOffice,
  unfollowOffice,
} from '@citizenrun/shared/api';

import { useOptimisticToggle } from '@/lib/optimistic';

import { OFFICE_CACHE_FILTERS, patchOfficeViewer } from './office-cache';

export type OfficeToggles = {
  setFollowing: (officeId: string, following: boolean) => void;
  setBookmarked: (officeId: string, bookmarked: boolean) => void;
};

type FollowVars = { officeId: string; following: boolean };
type BookmarkVars = { officeId: string; bookmarked: boolean };

/** Follow and Bookmark of an office, optimistic: every cached copy of the office changes at once. */
export function useOfficeToggles(): OfficeToggles {
  // E-OFF-04 / E-OFF-05
  const follow = useOptimisticToggle<FollowVars>({
    mutationFn: ({ officeId, following }) =>
      following ? followOffice(officeId) : unfollowOffice(officeId),
    action: ({ following }) => (following ? 'follow' : 'unfollow'),
    places: ({ officeId, following }) => [
      {
        filters: OFFICE_CACHE_FILTERS,
        patch: (data) => patchOfficeViewer(data, officeId, { following }),
      },
    ],
    invalidate: () => [OFFICE_CACHE_FILTERS],
  });
  // E-OFF-06 / E-OFF-07
  const bookmark = useOptimisticToggle<BookmarkVars>({
    mutationFn: ({ officeId, bookmarked }) =>
      bookmarked ? bookmarkOffice(officeId) : unbookmarkOffice(officeId),
    action: ({ bookmarked }) => (bookmarked ? 'bookmark' : 'unbookmark'),
    places: ({ officeId, bookmarked }) => [
      {
        filters: OFFICE_CACHE_FILTERS,
        patch: (data) => patchOfficeViewer(data, officeId, { bookmarked }),
      },
    ],
    invalidate: () => [OFFICE_CACHE_FILTERS],
  });
  return {
    setFollowing: (officeId, following) => {
      follow.toggle({ officeId, following });
    },
    setBookmarked: (officeId, bookmarked) => {
      bookmark.toggle({ officeId, bookmarked });
    },
  };
}

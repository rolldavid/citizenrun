import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { linksFake } from '@/test/platform/links';

import { useSystemUpdateViewModel } from './use-system-update-view-model';

describe('useSystemUpdateViewModel', () => {
  it('follows the store listing capability', () => {
    linksFake.setStoreListingSupported(true);
    expect(renderHook(() => useSystemUpdateViewModel()).result.current.storeSupported).toBe(true);
    linksFake.setStoreListingSupported(false);
    expect(renderHook(() => useSystemUpdateViewModel()).result.current.storeSupported).toBe(false);
  });

  it('opens the store listing', () => {
    linksFake.setStoreListingSupported(true);
    const { result } = renderHook(() => useSystemUpdateViewModel());
    expect(linksFake.calls).toEqual([]);
    result.current.onOpenStore();
    expect(linksFake.calls).toEqual([{ op: 'openStoreListing' }]);
  });
});

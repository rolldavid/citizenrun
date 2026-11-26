import type { AddressSuggestProvider } from './types.ts';

/** The development mode while no provider key is set (OI-geoapify): no suggestions, no request. */
export const noneProvider: AddressSuggestProvider = Object.freeze({
  name: 'none',
  suggest: () => Promise.resolve([]),
});

import type { Deps } from '../../../deps.ts';
import { createGeoapifyProvider } from './geoapify.ts';
import { noneProvider } from './none.ts';
import type { AddressSuggestProvider } from './types.ts';

export { GeoProviderError, createGeoapifyProvider } from './geoapify.ts';
export { noneProvider } from './none.ts';
export type { AddressSuggestProvider } from './types.ts';

// One provider per Deps, chosen from its environment on first use (D-452: no Deps member).
const providers = new WeakMap<Deps, AddressSuggestProvider>();

/** The address-suggestion provider of `deps`: Geoapify only with its key set, otherwise none. */
export function providerOf(deps: Deps): AddressSuggestProvider {
  let provider = providers.get(deps);
  if (provider === undefined) {
    const key = deps.env.GEO_API_KEY;
    provider =
      deps.env.geoProvider === 'geoapify' && key !== null
        ? createGeoapifyProvider(deps.outbound, key)
        : noneProvider;
    providers.set(deps, provider);
  }
  return provider;
}

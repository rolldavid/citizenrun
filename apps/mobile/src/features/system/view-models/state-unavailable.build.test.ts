import { describe, expect, it } from 'vitest';

import { stateUnavailableViewModel } from './state-unavailable.build';

const onBack = (): void => {};

describe('stateUnavailableViewModel', () => {
  it('offers deletion only when signed in', () => {
    expect(stateUnavailableViewModel({ stateCode: null, signedIn: true, onBack }).deleteHref).toBe(
      '/settings/delete-account',
    );
    expect(
      stateUnavailableViewModel({ stateCode: 'VT', signedIn: false, onBack }).deleteHref,
    ).toBeNull();
  });

  it('browses from /', () => {
    const view = stateUnavailableViewModel({ stateCode: 'VT', signedIn: false, onBack });
    expect(view).toEqual({
      stateCode: 'VT',
      signedIn: false,
      browseHref: '/',
      deleteHref: null,
      onBack,
    });
    expect(view.onBack).toBe(onBack);
  });
});

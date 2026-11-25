import { afterEach, describe, expect, it } from 'vitest';

import { clearSideChrome, reportSideChrome, sideChromeWidth } from './side-chrome';

const REPORTERS = ['root-shell', 'inner-shell'] as const;

afterEach(() => {
  for (const id of REPORTERS) clearSideChrome(id);
});

describe('side chrome', () => {
  it('no rail stands beside the content until a shell says so', () => {
    expect(sideChromeWidth()).toBe(0);

    // A shell without navigation chrome reports 0 while mounted.
    reportSideChrome('root-shell', 0);
    expect(sideChromeWidth()).toBe(0);

    // A shell inside it draws the rail: the widest report is the rail the content stands beside.
    reportSideChrome('inner-shell', 220);
    expect(sideChromeWidth()).toBe(220);

    // The window narrows and the rail loses its words.
    reportSideChrome('inner-shell', 72);
    expect(sideChromeWidth()).toBe(72);

    // A shell that unmounts is forgotten.
    clearSideChrome('inner-shell');
    expect(sideChromeWidth()).toBe(0);
    clearSideChrome('root-shell');
    clearSideChrome('root-shell');
    expect(sideChromeWidth()).toBe(0);
  });
});

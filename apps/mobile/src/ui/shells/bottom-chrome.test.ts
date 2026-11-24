import { afterEach, describe, expect, it } from 'vitest';

import { bottomChromeHeight, clearBottomChrome, reportBottomChrome } from './bottom-chrome';

const REPORTERS = ['tab-bar', 'footer', 'composer'] as const;

afterEach(() => {
  for (const id of REPORTERS) clearBottomChrome(id);
});

describe('bottom chrome', () => {
  it('the largest report wins and an unmounted reporter counts as 0', () => {
    // Nothing covers the bottom edge until something says so.
    expect(bottomChromeHeight()).toBe(0);

    reportBottomChrome('tab-bar', 56);
    expect(bottomChromeHeight()).toBe(56);

    // Two reporters never add up: the taller one is what the content clears.
    reportBottomChrome('footer', 88);
    expect(bottomChromeHeight()).toBe(88);
    reportBottomChrome('composer', 40);
    expect(bottomChromeHeight()).toBe(88);

    // A reporter that unmounts is forgotten, and the next largest stands.
    clearBottomChrome('footer');
    expect(bottomChromeHeight()).toBe(56);
    clearBottomChrome('tab-bar');
    expect(bottomChromeHeight()).toBe(40);
    clearBottomChrome('composer');
    expect(bottomChromeHeight()).toBe(0);

    // Forgetting one that was never there changes nothing.
    clearBottomChrome('footer');
    expect(bottomChromeHeight()).toBe(0);
  });

  it('a reporter replaces its own last report', () => {
    reportBottomChrome('tab-bar', 56);
    reportBottomChrome('tab-bar', 90);
    expect(bottomChromeHeight()).toBe(90);

    // The bar leaves while the keyboard is open and reports 0 without unmounting.
    reportBottomChrome('tab-bar', 0);
    expect(bottomChromeHeight()).toBe(0);

    reportBottomChrome('footer', 72);
    reportBottomChrome('tab-bar', 56);
    expect(bottomChromeHeight()).toBe(72);
  });
});

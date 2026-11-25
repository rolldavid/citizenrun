import { cleanup, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import { gutter } from '@/ui/tokens';

import { ListSpikeScreen } from './list-spike-screen';

/** What the screen's list hands the list library, as far as the stand-in reads it. */
type Handed = {
  data?: readonly unknown[] | null;
  renderItem?:
    ((info: { item: unknown; index: number; target: 'Cell' }) => ReactElement | null) | null;
  keyExtractor?: (item: unknown, index: number) => string;
  ItemSeparatorComponent?: ComponentType | null;
};

// The list library lays its rows out by measuring, and the test page measures nothing: a stand-in
// that draws every row and the rule after it takes its place.
vi.mock('@shopify/flash-list', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  function StandIn(props: Handed): ReactElement {
    const { data, renderItem, keyExtractor, ItemSeparatorComponent: Separator } = props;
    const items = data ?? [];
    return createElement(
      'div',
      null,
      items.map((item, index) =>
        createElement(
          'div',
          { key: keyExtractor?.(item, index) ?? String(index) },
          renderItem?.({ item, index, target: 'Cell' }),
          Separator !== null && Separator !== undefined && index < items.length - 1
            ? createElement('div', { 'data-rule': index }, createElement(Separator))
            : null,
        ),
      ),
    );
  }
  return { ...actual, FlashList: StandIn };
});
// react-native-safe-area-context 5.11.1 names its CommonJS build as `main`. The test resolver picks
// that build, and it loads the phone's React Native; the module build is the one that runs on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// The screen loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('the list spike loads no asset');
  },
}));

const VIEWPORTS = [
  [360, 740, gutter.narrow],
  [430, 932, gutter.regular],
  [820, 1180, gutter.regular],
  [1440, 900, gutter.regular],
] as const;

afterEach(cleanup);

/** The room an element and the boxes round it, up to the screen, keep at its left and right. */
function sideRoom(element: HTMLElement, root: HTMLElement): { left: number; right: number } {
  let left = 0;
  let right = 0;
  for (let box: HTMLElement | null = element; box !== null; box = box.parentElement) {
    left += (parseFloat(box.style.paddingLeft) || 0) + (parseFloat(box.style.marginLeft) || 0);
    right += (parseFloat(box.style.paddingRight) || 0) + (parseFloat(box.style.marginRight) || 0);
    if (box === root) break;
  }
  return { left, right };
}

describe('ListSpikeScreen', () => {
  it('rows and rules start at the gutter, where the heading does', () => {
    for (const [width, height, clear] of VIEWPORTS) {
      cleanup();
      setViewport(width, height);
      renderWithProviders(<ListSpikeScreen rows="6" />);
      const root = screen.getByTestId('dev.list-spike');
      const name = String(width);

      const heading = screen.getByRole('heading', { level: 1, name: 'List spike' });
      expect(sideRoom(heading, root), name).toEqual({ left: clear, right: clear });

      // Every kind of row keeps one gutter at each side, not the frame's and its own.
      for (const index of [0, 1, 2, 3, 4, 5]) {
        const row = screen.getByTestId(`dev.list-spike-row-${String(index)}`);
        expect(sideRoom(row, root), `${name} row ${String(index)}`).toEqual({
          left: clear,
          right: clear,
        });
      }

      // The rule between two rows is held in by the same gutter.
      const rules = [...root.querySelectorAll<HTMLElement>('[data-rule] > *')];
      expect(rules, name).toHaveLength(5);
      for (const rule of rules) {
        expect(sideRoom(rule, root), name).toEqual({ left: clear, right: clear });
      }
    }
  });
});

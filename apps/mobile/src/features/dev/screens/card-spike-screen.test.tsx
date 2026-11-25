import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { headFake } from '@/test/platform/head';
import { renderWithProviders, setViewport } from '@/test/render';
import { FontsProvider } from '@/ui/fonts';
import { layoutFor } from '@/ui/shells/use-breakpoint';
import { color, gutter } from '@/ui/tokens';

import { CardSpikeScreen } from './card-spike-screen';

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
// An interface icon loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('an interface icon loads no asset');
  },
}));

/** The window of a desktop browser, the size every case starts from. */
const DESKTOP = { width: 1440, height: 900 };

function draw(ui: ReactElement = <CardSpikeScreen />): void {
  renderWithProviders(ui);
}

/** The box around the canvas, which carries its description. */
function card(): HTMLElement {
  return screen.getByTestId('dev.card-spike-card');
}

/** The one canvas inside the card's box. */
function canvas(): SVGSVGElement {
  const found = card().querySelectorAll('svg');
  expect(found).toHaveLength(1);
  const svg = found[0];
  if (svg === undefined) {
    throw new Error('the card holds no canvas');
  }
  return svg;
}

/** The fill of the canvas's ground, its first rectangle. */
function groundFill(): string | null {
  const ground = canvas().querySelector('rect');
  if (ground === null) {
    throw new Error('the canvas has no ground');
  }
  return ground.getAttribute('fill');
}

function caption(): string | null {
  return screen.getByTestId('dev.card-spike-caption').textContent;
}

function pressTheme(): void {
  fireEvent.click(screen.getByTestId('dev.card-spike-theme'));
}

beforeEach(() => {
  setViewport(DESKTOP.width, DESKTOP.height);
});

afterEach(() => {
  cleanup();
});

describe('CardSpikeScreen', () => {
  it('the card draws when the fonts are ready', () => {
    draw();
    const svg = canvas();
    expect(svg.getAttribute('viewBox')).toBe('0 0 1080 1350');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(card().getAttribute('role')).toBe('img');
    expect(card().getAttribute('aria-label')).toMatch(/^Hello card/);
    expect(screen.getByRole('img', { name: /^Hello card/ })).toBe(card());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Card spike');
    expect(headFake.title()).toBe('Card spike');
  });

  it('the card waits for the fonts', () => {
    draw(
      <FontsProvider ready={false}>
        <CardSpikeScreen />
      </FontsProvider>,
    );
    expect(document.querySelector('svg')).toBeNull();
    expect(screen.queryByTestId('dev.card-spike-card')).toBeNull();
    const skeleton = screen.getByRole('progressbar');
    // The skeleton stands in the card's own box: as wide as the canvas will be.
    const width = layoutFor({ ...DESKTOP, fontScale: 1, topBarHeight: 0 }).canvasWidth;
    expect(parseFloat(skeleton.parentElement?.style.width ?? '')).toBeCloseTo(width, 6);
    // The caption and the control are there from the first frame.
    expect(caption()).toBe(`HelloCard, ${width.toFixed(1)} points wide, light theme`);
    expect(screen.getByTestId('dev.card-spike-theme')).toBeTruthy();
  });

  it("the card is as wide as the layout's canvas", () => {
    draw();
    const width = layoutFor({
      width: window.innerWidth,
      height: window.innerHeight,
      fontScale: 1,
      topBarHeight: 0,
    }).canvasWidth;
    // 80% of the window's free height at this size, so neither the window nor the feed column.
    expect(width).toBeCloseTo(540.8, 6);
    expect(canvas().getAttribute('width')).toBe(String(width));
    // The card's height to one decimal: 5 to 4.
    expect(canvas().getAttribute('height')).toBe(String(Math.round(width * 12.5) / 10));
    expect(canvas().getAttribute('height')).toBe('676');
    expect(parseFloat(card().style.width)).toBeCloseTo(540.8, 6);
    expect(caption()).toBe('HelloCard, 540.8 points wide, light theme');
  });

  it('the card is as wide as the window on a phone and leaves the gutters', () => {
    setViewport(390, 844);
    draw();
    expect(canvas().getAttribute('width')).toBe('390');
    expect(canvas().getAttribute('height')).toBe('487.5');
    expect(card().style.width).toBe('390px');
    // The frame keeps a gutter at each side for the heading and the caption; the card reaches both edges.
    const bleed = card().parentElement;
    expect(bleed?.style.marginLeft).toBe(`${String(-gutter.regular)}px`);
    expect(bleed?.style.marginRight).toBe(`${String(-gutter.regular)}px`);
    expect(caption()).toBe('HelloCard, 390.0 points wide, light theme');
  });

  it('the card stops at a side inset on a phone', () => {
    setViewport(430, 932);
    draw(
      <SafeAreaInsetsContext.Provider value={{ top: 59, right: 28, bottom: 34, left: 0 }}>
        <CardSpikeScreen />
      </SafeAreaInsetsContext.Provider>,
    );
    // The window less the strip the system keeps at the right.
    expect(canvas().getAttribute('width')).toBe('402');
    expect(card().style.width).toBe('402px');
    expect(caption()).toBe('HelloCard, 402.0 points wide, light theme');
    // The frame's padding holds the inset; the card leaves only the gutter.
    const bleed = card().parentElement;
    expect(bleed?.style.marginLeft).toBe(`${String(-gutter.regular)}px`);
    expect(bleed?.style.marginRight).toBe(`${String(-gutter.regular)}px`);
    expect(bleed?.parentElement?.style.paddingRight).toBe(`${String(gutter.regular + 28)}px`);
  });

  it('the card stands at the left edge of the gutter on a wider window', () => {
    setViewport(820, 1180);
    draw();
    expect(canvas().getAttribute('width')).toBe('600');
    expect(card().style.alignSelf).toBe('flex-start');
    const bleed = card().parentElement;
    expect(bleed?.style.marginLeft).toBe('');
    expect(bleed?.style.marginRight).toBe('');
    // The line under the card ends where the card ends.
    expect(screen.getByTestId('dev.card-spike-caption').parentElement?.style.width).toBe('600px');
  });

  it('the theme control redraws the card', () => {
    draw();
    const control = (): string | null =>
      screen.getByTestId('dev.card-spike-theme').getAttribute('aria-label');
    expect(control()).toBe('Theme: system');
    expect(groundFill()).toBe(color.light.surface);
    expect(caption()).toMatch(/light theme$/);

    pressTheme();
    expect(control()).toBe('Theme: light');
    expect(groundFill()).toBe(color.light.surface);

    pressTheme();
    expect(control()).toBe('Theme: dark');
    expect(groundFill()).toBe(color.dark.surface);
    expect(caption()).toMatch(/dark theme$/);
    // The whole canvas took the dark theme's colors, not its ground alone.
    const title = [...canvas().querySelectorAll('text')].find(
      (text) => text.textContent === 'Treasurer',
    );
    expect(title?.getAttribute('fill')).toBe(color.dark.text);

    pressTheme();
    expect(control()).toBe('Theme: system');
    expect(groundFill()).toBe(color.light.surface);
  });

  it('the photo is the fixture JPEG', () => {
    draw();
    const images = [...canvas().querySelectorAll('image')];
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.getAttribute('href')).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    }
    // Both draw the same photograph.
    expect(images[0]?.getAttribute('href')).toBe(images[1]?.getAttribute('href'));
  });
});

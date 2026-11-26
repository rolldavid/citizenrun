import { isValidElement } from 'react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as NativeIndex from './index.native';
import type * as ProviderArt from './provider-art';
import type { AppleSignInButtonProps, ProviderButtonAppearance } from './types';

// The phone file of the module, with every library it imports replaced: the parts of React Native
// and of the drawing library are plain names, so the tree the button returns can be read as it is.
const rn = vi.hoisted(() => ({
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('react-native', () => rn);
vi.mock('react-native-svg', () => ({
  Svg: 'Svg',
  G: 'G',
  Path: 'Path',
  Rect: 'Rect',
  Text: 'SvgText',
}));
vi.mock('@/lib/env', () => ({
  getAppEnv: () => ({
    appStoreUrl: null,
    playStoreUrl: null,
    googleIosClientId: null,
    googleWebClientId: null,
    appleServicesId: null,
  }),
}));
vi.mock('@/platform/session', () => ({ session: { apiOrigin: 'http://api.test' } }));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));
vi.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: 'AppleAuthenticationButton',
  AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
  AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
vi.mock('expo-web-browser', () => ({
  WebBrowserResultType: {
    CANCEL: 'cancel',
    DISMISS: 'dismiss',
    OPENED: 'opened',
    LOCKED: 'locked',
  },
}));
vi.mock('react-native-nitro-google-signin', () => ({
  GoogleOneTapSignIn: {},
  GoogleSignInButton: 'LibraryGoogleButton',
  GOOGLE_SIGN_IN_BUTTON_HEIGHT: 48,
  GOOGLE_SIGN_IN_BUTTON_WIDTH: { standard: 230, wide: 312, icon: 48 },
}));

type Element = ReactElement<Record<string, unknown>>;
type AppleStyle = ProviderButtonAppearance['appleStyle'];

const STYLES: readonly AppleStyle[] = ['black', 'white', 'white_outline'];
/** Pure black and pure white, as the value of a six-digit color. */
const BLACK = 0x000000;
const WHITE = 0xffffff;
const LABEL = 'fixture-apple-label';
const TEST_ID = 'auth.fixture-apple';
/** A fixture drawing in place of Apple's artwork: a 30 by 44 box with one outline. */
const FIXTURE_LOGO: ProviderArt.AppleLogoArt = { width: 30, height: 44, d: 'M0 0h30v44h-30z' };

function appearanceOf(appleStyle: AppleStyle, width = 320, height = 44): ProviderButtonAppearance {
  return {
    appleStyle,
    googleTheme: 'outline',
    googleShape: 'rectangular',
    googleSize: 'large',
    width,
    height,
  };
}

function propsOf(appearance: ProviderButtonAppearance, disabled = false): AppleSignInButtonProps {
  return {
    nonceHash: 'h',
    state: 's',
    appearance,
    disabled,
    onStart: () => undefined,
    onResult: () => undefined,
    testID: TEST_ID,
    accessibilityLabel: LABEL,
  };
}

/** The value of a color written as six hexadecimal digits after its mark. */
function rgb(color: string): number {
  if (!/^.[0-9a-f]{6}$/i.test(color)) {
    throw new Error(`${color} is not a six-digit color`);
  }
  return Number.parseInt(color.slice(1), 16);
}

/**
 * The tree a component draws, with every function component in it called the way React would
 * call it. The module's own components use no hook, so no renderer is needed.
 */
function expand(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(expand);
  }
  if (!isValidElement<Record<string, unknown>>(node)) {
    return node;
  }
  if (typeof node.type === 'function') {
    return expand((node.type as (props: unknown) => unknown)(node.props));
  }
  return { ...node, props: { ...node.props, children: expand(node.props['children']) } };
}

/** Every element of an expanded tree whose type is `type`, depth first. */
function all(node: unknown, type: string): Element[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => all(child, type));
  }
  if (!isValidElement<Record<string, unknown>>(node)) {
    return [];
  }
  return [...(node.type === type ? [node] : []), ...all(node.props['children'], type)];
}

function one(node: unknown, type: string): Element {
  const found = all(node, type);
  if (found.length !== 1 || found[0] === undefined) {
    throw new Error(`the tree holds ${String(found.length)} ${type}`);
  }
  return found[0];
}

/** The Android button of the module's real phone file, drawn once. */
async function draw(
  appearance: ProviderButtonAppearance,
  options: { disabled?: boolean; logo?: ProviderArt.AppleLogoArt | null } = {},
): Promise<Element> {
  vi.resetModules();
  if (options.logo !== undefined) {
    const logo = options.logo;
    vi.doMock('./provider-art', async () => ({
      ...(await vi.importActual<typeof ProviderArt>('./provider-art')),
      APPLE_LOGO: logo,
    }));
  }
  const { auth } = await vi.importActual<typeof NativeIndex>('./index.native');
  const Button = auth.AppleSignInButton as (props: AppleSignInButtonProps) => unknown;
  const tree = expand(Button(propsOf(appearance, options.disabled)));
  if (!isValidElement<Record<string, unknown>>(tree)) {
    throw new Error('the button drew nothing');
  }
  return tree;
}

async function art(): Promise<typeof ProviderArt.APPLE_CUSTOM_BUTTON> {
  return (await vi.importActual<typeof ProviderArt>('./provider-art')).APPLE_CUSTOM_BUTTON;
}

afterEach(() => {
  vi.doUnmock('./provider-art');
});

describe("Apple's button face on Android", () => {
  it('the Android Apple face draws the label', async () => {
    const custom = await art();
    const tree = await draw(appearanceOf('black', 320, 44));
    const title = one(tree, 'SvgText');
    expect(title.props['children']).toBe(LABEL);
    // In the system font, at Apple's share of the button's height, at the middle of the button.
    expect(title.props['fontFamily']).toBeUndefined();
    expect(custom.titleSizeOfButtonHeight).toBe(0.43);
    expect(title.props['fontSize']).toBeCloseTo(44 * 0.43, 10);
    expect(title.props['fontWeight']).toBe(custom.titleWeight);
    expect(title.props['textAnchor']).toBe('middle');
    expect(title.props['alignmentBaseline']).toBe('central');
    expect(title.props['transform']).toEqual([{ translateX: 160 }, { translateY: 22 }]);

    // The title keeps its share of the height at any size the screen asks for.
    const tall = await draw(appearanceOf('black', 280, 56));
    expect(one(tall, 'SvgText').props['fontSize']).toBeCloseTo(56 * 0.43, 10);
    expect(one(tall, 'Svg').props).toMatchObject({ width: 280, height: 56 });
  });

  it('the press target carries the name', async () => {
    const tree = await draw(appearanceOf('black'));
    expect(tree.type).toBe('Pressable');
    expect(tree.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: LABEL,
      accessibilityState: { disabled: false },
      disabled: false,
      testID: TEST_ID,
      style: { width: 320, height: 44 },
    });
    // The drawing is hidden from screen readers, and the whole of it stands inside what is hidden.
    const hidden = one(tree, 'View');
    expect(hidden.props).toMatchObject({
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
    expect(all(tree, 'Svg')).toHaveLength(1);
    expect(all(hidden, 'Svg')).toHaveLength(1);
    expect(all(hidden, 'SvgText')).toHaveLength(1);
    // Nothing in the drawing takes a name or a press of its own.
    for (const part of ['Svg', 'Rect', 'SvgText']) {
      const { props } = one(tree, part);
      expect(props['accessibilityLabel'], part).toBeUndefined();
      expect(props['onPress'], part).toBeUndefined();
    }

    // Apple defines no disabled look: the face is the same while the button takes no press.
    const disabled = await draw(appearanceOf('black'), { disabled: true });
    expect(disabled.props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true },
    });
    expect(one(disabled, 'Rect').props).toEqual(one(tree, 'Rect').props);
    expect(one(disabled, 'SvgText').props).toEqual(one(tree, 'SvgText').props);
  });

  it('three styles', async () => {
    const custom = await art();
    // Apple's three: the fill is black or white, and the logo and the title are both the other one.
    const { black, white, white_outline: outlined } = custom.styles;
    expect([rgb(black.background), rgb(black.foreground), black.outline]).toEqual([
      BLACK,
      WHITE,
      null,
    ]);
    expect([rgb(white.background), rgb(white.foreground), white.outline]).toEqual([
      WHITE,
      BLACK,
      null,
    ]);
    expect([rgb(outlined.background), rgb(outlined.foreground), rgb(outlined.outline)]).toEqual([
      WHITE,
      BLACK,
      BLACK,
    ]);
    for (const style of STYLES) {
      const look = custom.styles[style];
      const tree = await draw(appearanceOf(style), { logo: FIXTURE_LOGO });
      const ground = one(tree, 'Rect');
      expect(ground.props['fill'], style).toBe(look.background);
      expect(ground.props['rx'], style).toBe(custom.cornerRadius);
      expect(ground.props['ry'], style).toBe(custom.cornerRadius);
      expect(one(tree, 'SvgText').props['fill'], style).toBe(look.foreground);
      expect(one(tree, 'Path').props['fill'], style).toBe(look.foreground);
      if (style === 'white_outline') {
        // The outline is drawn whole, inside the button's own box.
        expect(ground.props).toMatchObject({
          stroke: look.outline,
          strokeWidth: custom.outlineWidth,
          transform: [
            { translateX: custom.outlineWidth / 2 },
            { translateY: custom.outlineWidth / 2 },
          ],
          width: 320 - custom.outlineWidth,
          height: 44 - custom.outlineWidth,
        });
      } else {
        expect(ground.props, style).toMatchObject({
          stroke: 'none',
          strokeWidth: 0,
          transform: [{ translateX: 0 }, { translateY: 0 }],
          width: 320,
          height: 44,
        });
      }
    }
  });

  it("the logo is Apple's artwork, as tall as the button at the leading edge", async () => {
    const custom = await art();
    const tree = await draw(appearanceOf('black', 320, 66), { logo: FIXTURE_LOGO });
    // The outline of the artwork is drawn as it is given, scaled to the button's height and no more.
    expect(one(tree, 'Path').props['d']).toBe(FIXTURE_LOGO.d);
    expect(one(tree, 'G').props['transform']).toEqual([
      { translateX: custom.logoInset },
      { scale: 66 / 44 },
    ]);
    expect(custom.logoHeightOfButtonHeight).toBe(1);
    expect(custom.logoInset).toBe(0);

    // Without the artwork no logo is drawn: nothing stands in for it.
    const bare = await draw(appearanceOf('black'), { logo: null });
    expect(all(bare, 'Path')).toHaveLength(0);
    expect(all(bare, 'G')).toHaveLength(0);
    expect(one(bare, 'SvgText').props['children']).toBe(LABEL);
  });
});

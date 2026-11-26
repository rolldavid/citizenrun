// The values of the provider buttons this module draws itself. They are the providers' own, not the
// design system's, so lint rule citizenrun/tokens-only is off here and nowhere else in the module.
import { radius, rule } from '@citizenrun/shared';

/** One style of Apple's button: its fill, the one color of its logo and title, and its outline. */
export type AppleButtonLook = {
  background: string;
  foreground: string;
  /** Null where the style has no outline. */
  outline: string | null;
};

/**
 * Apple's rules for a custom Sign in with Apple button that holds a logo and a title:
 * https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple
 * ("Creating a custom Sign in with Apple button"). A value Apple leaves to the app is the app's own.
 */
export const APPLE_CUSTOM_BUTTON = {
  /** The fill stays black or white, and the logo and the title are both the other one. */
  styles: {
    black: { background: '#000000', foreground: '#FFFFFF', outline: null },
    white: { background: '#FFFFFF', foreground: '#000000', outline: null },
    white_outline: { background: '#FFFFFF', foreground: '#000000', outline: '#000000' },
  } satisfies Record<'black' | 'white' | 'white_outline', AppleButtonLook>,
  /** Apple names no width for the outline: the app's own rule width. */
  outlineWidth: rule.hairline,
  /** "A corner radius value that matches the other buttons in your UI": the radius of the app's controls. */
  cornerRadius: radius.control,
  /** The logo artwork carries its own padding and is as tall as the button, with none added. */
  logoHeightOfButtonHeight: 1,
  /** The artwork's own padding is its inset from the leading edge. */
  logoInset: 0,
  /** In the system font the title is 43% of the button's height. */
  titleSizeOfButtonHeight: 0.43,
  /** Apple leaves the weight to the app: the medium weight of the app's own button labels. */
  titleWeight: '500',
  /** The least margin between the title and the trailing edge, as a share of the button's width. */
  titleEndMarginOfButtonWidth: 0.08,
  minWidth: 140,
  minHeight: 30,
  /** The clear space round the button, as a share of its height. */
  marginOfButtonHeight: 0.1,
} as const;

/** Apple's logo artwork for a button with a title: the artwork's own box, padding included, and its outline. */
export type AppleLogoArt = { width: number; height: number; d: string };

/**
 * The logo, which is only ever Apple's own artwork from Apple Design Resources, copied unchanged
 * and never redrawn. Null until that artwork is here. A face without the logo is not Apple's
 * button, so while this is null Android reports Apple sign-in as unavailable and no screen offers it.
 */
export const APPLE_LOGO: AppleLogoArt | null = null;

// CARD-colors (D-270): a canvas reads no theme and no token module. Its caller builds these colors
// from the token values and passes them in.

export type CardTheme = 'light' | 'dark';

export type CanvasColors = {
  theme: CardTheme;
  bg: string;
  surface: string;
  text: string;
  textSecondary: string;
  ruleSoft: string;
  accent: string;
  highlight: string;
  onHighlight: string;
  posterBg: string;
  posterText: string;
  posterTextSecondary: string;
  /** Per issue id: fill is the theme's value, poster the dark-theme value in both themes, on the glyph color on a tile. */
  issue: Readonly<Record<string, { fill: string; poster: string; on: string }>>;
};

type CoreColorName =
  | 'bg'
  | 'surface'
  | 'text'
  | 'textSecondary'
  | 'ruleSoft'
  | 'accent'
  | 'highlight'
  | 'onHighlight'
  | 'posterBg'
  | 'posterText'
  | 'posterTextSecondary';

/** Builds the colors of one theme from the token module's values. Pure. */
export function canvasColorsFrom(
  theme: CardTheme,
  core: Readonly<Record<CoreColorName, string>>,
  issues: Readonly<Record<string, { light: string; dark: string; on: string }>>,
): CanvasColors {
  const issue = Object.fromEntries(
    Object.entries(issues).map(([id, value]) => [
      id,
      { fill: value[theme], poster: value.dark, on: value.on },
    ]),
  );
  return {
    theme,
    bg: core.bg,
    surface: core.surface,
    text: core.text,
    textSecondary: core.textSecondary,
    ruleSoft: core.ruleSoft,
    accent: core.accent,
    highlight: core.highlight,
    onHighlight: core.onHighlight,
    posterBg: core.posterBg,
    posterText: core.posterText,
    posterTextSecondary: core.posterTextSecondary,
    issue,
  };
}

/** The four color roles of a drawing. */
export type ArtRoles = { ink: string; paper: string; tone: string; spot: string };

/**
 * The colors a drawing takes on a paper or a poster ground. The tone is the issue's color; with a
 * null issue id, or one the colors do not hold, it is the ground's secondary text color.
 */
export function artRoles(
  colors: CanvasColors,
  issueId: string | null,
  ground: 'paper' | 'poster',
): ArtRoles {
  const issue =
    issueId !== null && Object.hasOwn(colors.issue, issueId) ? colors.issue[issueId] : undefined;
  if (ground === 'poster') {
    return {
      ink: colors.posterText,
      paper: colors.posterBg,
      tone: issue === undefined ? colors.posterTextSecondary : issue.poster,
      spot: colors.accent,
    };
  }
  return {
    ink: colors.text,
    paper: colors.surface,
    tone: issue === undefined ? colors.textSecondary : issue.fill,
    spot: colors.accent,
  };
}

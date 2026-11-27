// The package's public surface. Nothing else is imported from outside the package.
export { CANVAS, CAP_HEIGHT, PHOTO_BOX } from './canvas.ts';
export { canvasColorsFrom } from './colors.ts';
export type { CanvasColors, CardTheme } from './colors.ts';
export { HelloCard } from './templates/hello-card.tsx';
export type { HelloCardProps } from './templates/hello-card.tsx';
export { EmptyChairSvg } from './art/empty-chair.tsx';
export type { EmptyChairSvgProps } from './art/empty-chair.tsx';
export { IssueIconSvg } from './art/issue-icon.tsx';
export type { IssueIconSvgProps } from './art/issue-icon.tsx';
export { MONOGRAM, WORDMARK, WordmarkSvg } from './brand/wordmark.ts';
export type { WordmarkSvgProps } from './brand/wordmark.ts';
export {
  clipText,
  fitNumber,
  fitOneLine,
  fitWrapped,
  layoutText,
  measureText,
} from './layout-text.ts';
export { canDraw, foldForCanvas } from './text/fold.ts';
export { officeSourceLines } from './text/source-line.ts';
export { illustrationFor, OfficeArtSvg } from './art/office-art.tsx';
export type { OfficeArtSvgProps } from './art/office-art.tsx';
export { OfficeGlyphSvg } from './art/office-glyph.tsx';
export type { OfficeGlyphSvgProps } from './art/office-glyph.tsx';
export { OFFICE_ART_IDS } from './generated/index.ts';
export type { CardContext } from './feed.ts';

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

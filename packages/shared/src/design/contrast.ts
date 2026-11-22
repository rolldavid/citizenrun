// Declared contrast pairs (DS-contrast). The functions that check them live beside them.
import type { ColorToken } from './tokens.ts';

/** Text pairs: [text token, ground token]. Each must be at least 4.5:1 in both themes. */
export const TEXT_PAIRS: readonly (readonly [ColorToken, ColorToken])[] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'well'],
  ['noticeText', 'bg'],
  ['noticeText', 'surface'],
  ['noticeText', 'well'],
  ['linkText', 'bg'],
  ['linkText', 'surface'],
  ['linkText', 'well'],
  ['textSecondary', 'bg'],
  ['textSecondary', 'surface'],
  ['textSecondary', 'well'],
  ['disabledText', 'bg'],
  ['disabledText', 'surface'],
  ['disabledText', 'well'],
  ['onAccent', 'accent'],
  ['onAccent', 'accentHover'],
  ['onHighlight', 'highlight'],
  ['danger', 'bg'],
  ['danger', 'surface'],
  ['danger', 'well'],
  ['success', 'bg'],
  ['success', 'surface'],
  ['success', 'well'],
  ['inverseText', 'inverseBg'],
  ['inverseText', 'inverseHover'],
  ['selectedText', 'inverseBg'],
  ['selectedText', 'inverseHover'],
  ['inverseTextSecondary', 'inverseBg'],
  ['posterText', 'posterBg'],
  ['posterTextSecondary', 'posterBg'],
  ['mapLabel', 'mapLabelHalo'],
  ['mapLabelSecondary', 'mapLabelHalo'],
  ['bubbleText', 'bubbleBg'],
  // mediaControlBg is translucent: the check blends it over white and over black
  ['onMediaControl', 'mediaControlBg'],
];

/** Marks and control outlines: each must be at least 3:1 in both themes. */
export const MARK_PAIRS: readonly (readonly [ColorToken, ColorToken])[] = [
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['accentHover', 'bg'],
  ['accent', 'text'], // the spot on ink
  ['accent', 'posterBg'],
  ['rule', 'bg'],
  ['rule', 'surface'],
  ['rule', 'hoverBg'],
  ['focusRing', 'bg'],
  ['focusRing', 'surface'],
  ['textSecondary', 'bg'], // unlit pip and tick outlines
  ['textSecondary', 'surface'],
  ['danger', 'surface'], // field borders
  ['success', 'surface'],
  ['mapNoDataLine', 'mapNoData'],
];

/** For the "every text token is paired" case: each text token and every ground it may sit on. */
export const TEXT_GROUNDS: Readonly<Partial<Record<ColorToken, readonly ColorToken[]>>> = {
  text: ['bg', 'surface', 'well'],
  noticeText: ['bg', 'surface', 'well'],
  linkText: ['bg', 'surface', 'well'],
  textSecondary: ['bg', 'surface', 'well'],
  disabledText: ['bg', 'surface', 'well'],
  onAccent: ['accent', 'accentHover'],
  onHighlight: ['highlight'],
  danger: ['bg', 'surface', 'well'],
  success: ['bg', 'surface', 'well'],
  inverseText: ['inverseBg', 'inverseHover'],
  selectedText: ['inverseBg', 'inverseHover'],
  inverseTextSecondary: ['inverseBg'],
  posterText: ['posterBg'],
  posterTextSecondary: ['posterBg'],
  mapLabel: ['mapLabelHalo'],
  mapLabelSecondary: ['mapLabelHalo'],
  bubbleText: ['bubbleBg'],
  onMediaControl: ['mediaControlBg'],
};

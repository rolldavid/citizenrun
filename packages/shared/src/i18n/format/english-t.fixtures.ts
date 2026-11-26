import { createI18n } from '../index.ts';
import type { TFunction } from './t-function.ts';

/** The English `t` of createI18n(), as the formatters take it. */
export function englishT(): TFunction {
  const t = createI18n().getFixedT('en');
  return t as unknown as TFunction; // the typed t accepts catalog keys only; the formatters pass each key as a plain string
}

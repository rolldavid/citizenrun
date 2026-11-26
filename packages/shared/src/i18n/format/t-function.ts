/** i18next's t, bound to a locale: a key and its interpolation values in, the text out. */
export type TFunction = (key: string, vars?: Readonly<Record<string, string | number>>) => string;

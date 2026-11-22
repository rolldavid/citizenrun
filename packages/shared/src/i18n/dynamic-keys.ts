/**
 * Catalog keys that code reaches only through a computed lookup, never as a literal `t('...')`
 * argument, each written as `<namespace>:<key>` with the reason. The catalog check counts them as
 * used.
 */
export const DYNAMIC_KEYS: readonly { key: string; reason: string }[] = [];

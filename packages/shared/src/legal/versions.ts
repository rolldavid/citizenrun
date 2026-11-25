/**
 * The current version of each agreement, the date its document took effect (L-age-consent, D-464).
 * A new value marks a material change and asks every user to agree again.
 */
export const LEGAL_VERSIONS = {
  terms: '2026-11-25',
  content_policy: '2026-11-25',
  privacy_policy: '2026-11-25',
  ai_screening: '2026-11-25',
} as const;

export type LegalVersions = typeof LEGAL_VERSIONS;

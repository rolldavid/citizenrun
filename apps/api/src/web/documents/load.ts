// Reads, checks and renders the three legal pages once, before the server listens (L-legal-docs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGAL_VERSIONS, formatDate } from '@citizenrun/shared';
import type { BrandContacts, Logger, createI18n } from '@citizenrun/shared';
import type { ApiEnv } from '../../env.ts';
import { pendingContactKeys, placeholderValues } from './contacts.ts';
import { buildDocumentPage } from './page.ts';
import { DocumentError, renderDocument } from './render.ts';
import type { RenderedDocument } from './render.ts';

export const LEGAL_PAGES = [
  { id: 'privacy', path: '/privacy', file: 'privacy.md', versionKey: 'privacy_policy' },
  { id: 'terms', path: '/terms', file: 'terms.md', versionKey: 'terms' },
  {
    id: 'content-policy',
    path: '/content-policy',
    file: 'content-policy.md',
    versionKey: 'content_policy',
  },
] as const;

export type LegalPageId = (typeof LEGAL_PAGES)[number]['id'];
/** The complete HTML of each page. */
export type LegalDocumentPages = Readonly<Record<LegalPageId, string>>;
/** An English translator, as `createI18n().getFixedT('en')` returns it. */
export type TFunction = ReturnType<typeof createI18n>['t'];
export type AppEnv = ApiEnv['APP_ENV'];

const LOCALE_FOLDER = 'en';

function readDocument(dir: string, file: string): string {
  try {
    return readFileSync(join(dir, LOCALE_FOLDER, file), 'utf8');
  } catch {
    throw new DocumentError('front_matter', `${file} missing`, file);
  }
}

// One file rendered; a rule it breaks is reported with the file's name.
function renderFile(
  src: string,
  file: string,
  input: Parameters<typeof renderDocument>[1],
): RenderedDocument {
  try {
    return renderDocument(src, input);
  } catch (error) {
    if (error instanceof DocumentError) {
      throw new DocumentError(error.reason, error.detail, file);
    }
    throw error;
  }
}

/**
 * Reads, checks and renders the three pages; synchronous. Throws DocumentError naming the file when
 * a file is missing, breaks a rule of the subset, or carries a version other than its
 * LEGAL_VERSIONS value.
 */
export function loadLegalDocuments(input: {
  dir: string;
  appName: string;
  publicUrl: string;
  contacts: BrandContacts;
  t: TFunction;
}): LegalDocumentPages {
  const { t } = input;
  const values = placeholderValues(input);
  const pendingText = t('common:legalPages.contactPending');
  const footer = [
    { href: '/privacy', label: t('common:legalPages.footerPrivacy') },
    { href: '/terms', label: t('common:legalPages.footerTerms') },
    { href: '/content-policy', label: t('common:legalPages.footerContentPolicy') },
  ];
  const pages: Partial<Record<LegalPageId, string>> = {};
  for (const page of LEGAL_PAGES) {
    const doc = renderFile(readDocument(input.dir, page.file), page.file, { values, pendingText });
    if (doc.version !== LEGAL_VERSIONS[page.versionKey]) {
      throw new DocumentError('front_matter', 'the version differs from LEGAL_VERSIONS', page.file);
    }
    pages[page.id] = buildDocumentPage(doc, {
      appName: input.appName,
      publicUrl: input.publicUrl,
      path: page.path,
      documentTitle: t('common:legalPages.documentTitle', {
        title: doc.title,
        appName: input.appName,
      }),
      effectiveDate: t('common:legalPages.effectiveDate', {
        date: formatDate(doc.version, 'en', 'long'),
      }),
      footer,
    });
  }
  const { privacy, terms } = pages;
  const contentPolicy = pages['content-policy'];
  if (privacy === undefined || terms === undefined || contentPolicy === undefined) {
    throw new Error('A legal page was not rendered.');
  }
  return { privacy, terms, 'content-policy': contentPolicy };
}

/**
 * The start-up step: loadLegalDocuments, then on staging and production one `warn` line
 * `contacts_pending` naming the null contact keys, never a value. It never refuses to start over a
 * contact (D-416).
 */
export function prepareLegalDocuments(
  input: Parameters<typeof loadLegalDocuments>[0] & { appEnv: AppEnv; logger: Logger },
): LegalDocumentPages {
  const pages = loadLegalDocuments(input);
  if (input.appEnv === 'staging' || input.appEnv === 'production') {
    const keys = pendingContactKeys(input.contacts);
    if (keys.length > 0) {
      input.logger.warn('contacts_pending', { keys });
    }
  }
  return pages;
}

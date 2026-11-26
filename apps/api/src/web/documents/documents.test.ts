import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRAND,
  DOCUMENT_PAGE_CSS,
  LEGAL_VERSIONS,
  brandVariant,
  createI18n,
  createLogger,
} from '@citizenrun/shared';
import type { BrandContacts } from '@citizenrun/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { pendingContactKeys, placeholderValues } from './contacts.ts';
import { LEGAL_PAGES, loadLegalDocuments, prepareLegalDocuments } from './load.ts';
import type { AppEnv } from './load.ts';
import { buildDocumentPage } from './page.ts';
import { DocumentError, PLACEHOLDER_NAMES, renderDocument } from './render.ts';
import type { PlaceholderValues } from './render.ts';

const DOCUMENTS_DIR = fileURLToPath(new URL('../../../assets/documents/', import.meta.url));
const APP_NAME = brandVariant('development').displayName;
const PUBLIC_URL = 'https://app.example.test';
const PENDING = 'Not published yet.';
const t = createI18n({ lng: 'en' }).getFixedT('en');

const NULL_CONTACTS: BrandContacts = {
  supportEmail: null,
  postalAddress: null,
  dmcaAgent: { name: null, address: null, phone: null, email: null },
  childSafetyContact: { name: null, email: null },
};
// Visibly fake contacts, never real ones.
const FIXTURE_CONTACTS: BrandContacts = {
  supportEmail: 'support@example.test',
  postalAddress: '1 Fixture Way, Testville, ZZ 00000',
  dmcaAgent: {
    name: 'Fixture Agent',
    address: '2 Fixture Lane, Testville, ZZ 00000',
    phone: '+1 555 0100',
    email: 'agent@example.test',
  },
  childSafetyContact: { name: 'Fixture Safety Lead', email: 'safety@example.test' },
};
// The placeholders that render the pending sentence while their contact is null.
const CONTACT_PLACEHOLDERS = [
  'supportEmail',
  'postalAddress',
  'dmcaAgentAddress',
  'dmcaAgentPhone',
  'dmcaAgentEmail',
  'childSafetyContactEmail',
] as const;

function values(overrides: Partial<PlaceholderValues> = {}): PlaceholderValues {
  return {
    ...placeholderValues({ appName: APP_NAME, publicUrl: PUBLIC_URL, contacts: FIXTURE_CONTACTS }),
    ...overrides,
  };
}

function render(body: string, overrides: Partial<PlaceholderValues> = {}): string {
  const src = `---\nversion: 2026-01-02\ntitle: T\ndescription: D\n---\n${body}`;
  return renderDocument(src, { values: values(overrides), pendingText: PENDING }).bodyHtml;
}

function reasonOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return error instanceof DocumentError ? error.reason : 'not a DocumentError';
  }
  return null;
}

function draft(file: string): string {
  return readFileSync(join(DOCUMENTS_DIR, 'en', file), 'utf8');
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function loadWith(contacts: BrandContacts): ReturnType<typeof loadLegalDocuments> {
  return loadLegalDocuments({
    dir: DOCUMENTS_DIR,
    appName: APP_NAME,
    publicUrl: PUBLIC_URL,
    contacts,
    t,
  });
}

let temporaryDirs: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  temporaryDirs = [];
});

describe('front matter', () => {
  it('a missing, a duplicate and an unknown front matter key each throw front_matter', () => {
    const missing = '---\nversion: 2026-01-02\ntitle: T\n---\nx';
    const duplicate = '---\nversion: 2026-01-02\ntitle: T\ntitle: U\ndescription: D\n---\nx';
    const unknown = '---\nversion: 2026-01-02\ntitle: T\ndescription: D\nauthor: A\n---\nx';
    for (const src of [missing, duplicate, unknown]) {
      expect(reasonOf(() => renderDocument(src, { values: values(), pendingText: PENDING }))).toBe(
        'front_matter',
      );
    }
    const noOpening = 'version: 2026-01-02\ntitle: T\ndescription: D\n---\nx';
    const noClosing = '---\nversion: 2026-01-02\ntitle: T\ndescription: D\nx';
    const empty = '---\nversion: 2026-01-02\ntitle: \ndescription: D\n---\nx';
    const notKeyValue = '---\nversion: 2026-01-02\ntitle T\ndescription: D\n---\nx';
    for (const src of [noOpening, noClosing, empty, notKeyValue]) {
      expect(reasonOf(() => renderDocument(src, { values: values(), pendingText: PENDING }))).toBe(
        'front_matter',
      );
    }
  });

  it('a version that is not a date throws front_matter', () => {
    for (const version of ['2026-1-02', 'soon', '2026-01-02x', '20260102']) {
      const src = `---\nversion: ${version}\ntitle: T\ndescription: D\n---\nx`;
      expect(reasonOf(() => renderDocument(src, { values: values(), pendingText: PENDING }))).toBe(
        'front_matter',
      );
    }
  });

  it('the values are trimmed and filled, and come back unescaped', () => {
    const src =
      '---\nversion:  2026-01-02 \ntitle:   <Rules> of {{appName}}  \ndescription: A: b & c\n---\n';
    const doc = renderDocument(src, { values: values(), pendingText: PENDING });
    expect(doc).toEqual({
      version: '2026-01-02',
      title: `<Rules> of ${APP_NAME}`,
      description: 'A: b & c',
      bodyHtml: '',
    });
  });

  it("each draft's version equals its LEGAL_VERSIONS value", () => {
    for (const page of LEGAL_PAGES) {
      const doc = renderDocument(draft(page.file), { values: values(), pendingText: PENDING });
      expect(doc.version, page.file).toBe(LEGAL_VERSIONS[page.versionKey]);
    }
  });
});

describe('the Markdown subset and escaping', () => {
  it('headings, paragraphs, lists, bold and links render to their tags', () => {
    const body = [
      '# One',
      '## Two',
      '### Three',
      'A paragraph',
      'on two lines with **bold** text.',
      '',
      '- first',
      '- second',
      '  continued',
      '1. one',
      '2. [two](/terms)',
      '',
      'Read [the policy](https://example.test/policy).',
    ].join('\n');
    expect(render(body)).toBe(
      [
        '<h1>One</h1>',
        '<h2>Two</h2>',
        '<h3>Three</h3>',
        '<p>A paragraph on two lines with <strong>bold</strong> text.</p>',
        '<ul><li>first</li><li>second continued</li></ul>',
        '<ol><li>one</li><li><a href="/terms">two</a></li></ol>',
        '<p>Read <a href="https://example.test/policy" rel="noopener noreferrer">the policy</a>.</p>',
      ].join('\n'),
    );
  });

  it('an external link carries rel noopener noreferrer and a path link carries none', () => {
    expect(render('[a](https://example.test/x?y=1&z=2)')).toBe(
      '<p><a href="https://example.test/x?y=1&amp;z=2" rel="noopener noreferrer">a</a></p>',
    );
    expect(render('[b](/privacy)')).toBe('<p><a href="/privacy">b</a></p>');
  });

  it('raw HTML in a file is shown as text', () => {
    const html = render('<script>alert(1)</script> <b onclick="x">&</b>');
    expect(html).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;b onclick=&quot;x&quot;&gt;&amp;&lt;/b&gt;</p>',
    );
    expect(html).not.toContain('<script');
  });

  it('a javascript link throws unsafe_link', () => {
    expect(reasonOf(() => render('[x](javascript:alert(1))'))).toBe('unsafe_link');
    expect(reasonOf(() => render('[x](//example.test/x)'))).toBe('unsafe_link');
    expect(reasonOf(() => render('[x](http://example.test/x)'))).toBe('unsafe_link');
  });

  it('a placeholder in a link throws placeholder_in_link', () => {
    expect(reasonOf(() => render('[x]({{publicUrl}}/terms)'))).toBe('placeholder_in_link');
  });

  it('a nested list throws nested_list', () => {
    expect(reasonOf(() => render('- a\n  - b'))).toBe('nested_list');
    expect(reasonOf(() => render('1. a\n\t2. b'))).toBe('nested_list');
  });

  it('an unmatched double asterisk stays literal', () => {
    expect(render('a ** b')).toBe('<p>a ** b</p>');
    expect(render('**a** and **b')).toBe('<p><strong>a</strong> and **b</p>');
  });

  it('underscores are not emphasis', () => {
    expect(render('fixture_handle and _x_')).toBe('<p>fixture_handle and _x_</p>');
  });

  it('CRLF line endings render like LF', () => {
    const lf = '---\nversion: 2026-01-02\ntitle: T\ndescription: D\n---\n## H\n\n- a\n- b\n\np\nq';
    const crlf = lf.replace(/\n/g, '\r\n');
    const input = { values: values(), pendingText: PENDING };
    expect(renderDocument(crlf, input)).toEqual(renderDocument(lf, input));
  });
});

describe('placeholders', () => {
  it('an unknown placeholder throws unknown_placeholder', () => {
    expect(reasonOf(() => render('Hello {{nobody}}'))).toBe('unknown_placeholder');
    const src = '---\nversion: 2026-01-02\ntitle: {{nobody}}\ndescription: D\n---\n';
    expect(reasonOf(() => renderDocument(src, { values: values(), pendingText: PENDING }))).toBe(
      'unknown_placeholder',
    );
  });

  it('every placeholder of the three drafts is known', () => {
    const all = Object.fromEntries(
      PLACEHOLDER_NAMES.map((name) => [name, `value of ${name}`]),
    ) as Record<(typeof PLACEHOLDER_NAMES)[number], string>; // every name is set just above
    for (const page of LEGAL_PAGES) {
      const doc = renderDocument(draft(page.file), { values: all, pendingText: PENDING });
      expect(doc.bodyHtml, page.file).not.toContain('{{');
      expect(doc.bodyHtml, page.file).not.toContain(PENDING);
    }
  });
});

describe('contacts', () => {
  it('every contact null renders the pending sentence at each contact spot', () => {
    const pages = loadWith(NULL_CONTACTS);
    for (const page of LEGAL_PAGES) {
      const src = draft(page.file);
      const spots = CONTACT_PLACEHOLDERS.reduce((sum, name) => sum + count(src, `{{${name}}}`), 0);
      expect(count(pages[page.id], PENDING), page.file).toBe(spots);
    }
    expect(count(draft('privacy.md'), '{{supportEmail}}')).toBeGreaterThan(0);
    // The agent's and the child-safety contact's names fall back to the app name.
    const nulls = placeholderValues({
      appName: APP_NAME,
      publicUrl: PUBLIC_URL,
      contacts: NULL_CONTACTS,
    });
    expect(nulls.dmcaAgentName).toBe(APP_NAME);
    expect(nulls.childSafetyContactName).toBe(APP_NAME);
    expect(count(draft('terms.md'), '- {{dmcaAgentName}}')).toBe(1);
    expect(pages.terms).toContain(`<li>${APP_NAME}</li>`);
  });

  it('every contact set renders each value and no pending sentence', () => {
    const pages = loadWith(FIXTURE_CONTACTS);
    for (const page of LEGAL_PAGES) {
      expect(pages[page.id], page.file).not.toContain(PENDING);
    }
    expect(pages.privacy).toContain('<li>Email: support@example.test</li>');
    expect(pages.privacy).toContain('<li>Postal address: 1 Fixture Way, Testville, ZZ 00000</li>');
    expect(pages.terms).toContain('<li>Fixture Agent</li>');
    expect(pages.terms).toContain('<li>Email: agent@example.test</li>');
    expect(pages.terms).toContain('<li>Postal address: 2 Fixture Lane, Testville, ZZ 00000</li>');
    expect(pages['content-policy']).toContain('agent@example.test');
    expect(pages['content-policy']).toContain('<li>Email: support@example.test</li>');
  });

  it('a null dmcaAgent beside a set support email and postal address uses them for the agent', () => {
    const contacts: BrandContacts = {
      ...NULL_CONTACTS,
      supportEmail: 'support@example.test',
      postalAddress: '1 Fixture Way, Testville, ZZ 00000',
    };
    const filled = placeholderValues({ appName: APP_NAME, publicUrl: PUBLIC_URL, contacts });
    expect(filled.dmcaAgentEmail).toBe('support@example.test');
    expect(filled.dmcaAgentAddress).toBe('1 Fixture Way, Testville, ZZ 00000');
    expect(filled.dmcaAgentName).toBe(APP_NAME);
    expect(filled.dmcaAgentPhone).toBeNull();
    expect(filled.childSafetyContactEmail).toBe('support@example.test');
    const terms = loadWith(contacts).terms;
    expect(terms).toContain(`<li>${APP_NAME}</li>`);
    expect(terms).toContain('<li>Email: support@example.test</li>');
    expect(terms).toContain('<li>Postal address: 1 Fixture Way, Testville, ZZ 00000</li>');
    expect(terms).not.toContain(PENDING);
  });

  it('a contact value with markup is escaped', () => {
    const contacts: BrandContacts = { ...NULL_CONTACTS, supportEmail: '<b>x</b>' };
    const privacy = loadWith(contacts).privacy;
    expect(privacy).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(privacy).not.toContain('<b>x</b>');
  });

  it('each contact placeholder stands alone on a list line, after its label', () => {
    const contactNames = PLACEHOLDER_NAMES.filter(
      (name) => name !== 'appName' && name !== 'publicUrl',
    );
    for (const page of LEGAL_PAGES) {
      for (const line of draft(page.file).split('\n')) {
        if (contactNames.some((name) => line.includes(`{{${name}}}`))) {
          expect(line, page.file).toMatch(/^- (?:[A-Z][a-z]+(?: [a-z]+)*: )?\{\{[A-Za-z]+\}\}$/);
        }
      }
    }
  });

  it('pendingContactKeys names the null leaves only', () => {
    expect(pendingContactKeys(NULL_CONTACTS)).toEqual([
      'supportEmail',
      'postalAddress',
      'dmcaAgent.name',
      'dmcaAgent.address',
      'dmcaAgent.phone',
      'dmcaAgent.email',
      'childSafetyContact.name',
      'childSafetyContact.email',
    ]);
    expect(pendingContactKeys(FIXTURE_CONTACTS)).toEqual([]);
  });
});

describe('required content', () => {
  it('the privacy policy names every recipient', () => {
    const privacy = draft('privacy.md');
    for (const text of [
      'Railway',
      'Tigris',
      'Resend',
      'Geoapify',
      'US Census Geocoder',
      'Anthropic',
      'Expo',
      'Apple',
      'Google',
      'OpenFreeMap',
      'Cloudflare',
      'GitHub',
      'NCMEC',
      'not end-to-end encrypted',
      'never sold',
      'Do-not-track',
      'We answer within 45 days.',
      '{{supportEmail}}',
    ]) {
      expect(privacy, text).toContain(text);
    }
  });

  it('the terms hold the zero-tolerance sentence and the parental-controls notice', () => {
    const terms = draft('terms.md');
    for (const text of [
      'We have zero tolerance for objectionable content and abusive users.',
      '47 U.S.C. 230(d)',
      'parental control protections',
      'This app is not affiliated with and does not represent any government or political entity.',
    ]) {
      expect(terms, text).toContain(text);
    }
  });

  it('the content policy holds the policy line and the 24-hour target', () => {
    const policy = draft('content-policy.md');
    for (const text of [
      'Hard criticism, satire and strong language about candidates, officials and their records stay up.',
      'within 24 hours',
      'how, when or where to vote',
    ]) {
      expect(policy, text).toContain(text);
    }
  });

  it('the drafts use no top-level heading', () => {
    for (const page of LEGAL_PAGES) {
      const lines = draft(page.file).split('\n');
      expect(
        lines.filter((line) => line.startsWith('# ')),
        page.file,
      ).toEqual([]);
    }
    // So the page's one h1 is the front matter's title.
    const pages = loadWith(NULL_CONTACTS);
    for (const page of LEGAL_PAGES) {
      expect(count(pages[page.id], '<h1>'), page.file).toBe(1);
    }
  });

  it('the drafts link only to pages that exist', () => {
    const existing = LEGAL_PAGES.map((page) => page.path);
    const pages = loadWith(NULL_CONTACTS);
    for (const page of LEGAL_PAGES) {
      const hrefs = [...pages[page.id].matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
      for (const href of hrefs) {
        if (href === `${PUBLIC_URL}${page.path}` || href === '/') {
          continue;
        }
        expect(existing, `${page.file} ${String(href)}`).toContain(href);
      }
    }
  });

  it('the drafts name the app only through its placeholder', () => {
    for (const page of LEGAL_PAGES) {
      const src = draft(page.file);
      for (const variant of ['development', 'staging', 'production'] as const) {
        expect(src, page.file).not.toContain(brandVariant(variant).displayName);
      }
      expect(src, page.file).not.toContain(BRAND.displayName);
    }
  });
});

describe('start-up', () => {
  function capture(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'api',
      level: 'debug',
      sink: (line) => {
        lines.push(line);
      },
    });
    return { logger, lines };
  }

  it('the API starts with every contact null in each APP_ENV', () => {
    for (const appEnv of ['local', 'ci', 'staging', 'production'] as const) {
      const { logger } = capture();
      const pages = prepareLegalDocuments({
        dir: DOCUMENTS_DIR,
        appName: APP_NAME,
        publicUrl: PUBLIC_URL,
        contacts: NULL_CONTACTS,
        t,
        appEnv,
        logger,
      });
      expect(Object.keys(pages).sort(), appEnv).toEqual(['content-policy', 'privacy', 'terms']);
      for (const html of Object.values(pages)) {
        expect(html.startsWith('<!doctype html>'), appEnv).toBe(true);
      }
    }
  });

  it('contacts_pending is logged only on staging and production, with key names and no value', () => {
    const run = (appEnv: AppEnv, contacts: BrandContacts): Record<string, unknown>[] => {
      const { logger, lines } = capture();
      prepareLegalDocuments({
        dir: DOCUMENTS_DIR,
        appName: APP_NAME,
        publicUrl: PUBLIC_URL,
        contacts,
        t,
        appEnv,
        logger,
      });
      return lines.map((line) => JSON.parse(line) as Record<string, unknown>); // logger lines are JSON objects
    };
    for (const appEnv of ['staging', 'production'] as const) {
      const lines = run(appEnv, NULL_CONTACTS);
      expect(lines, appEnv).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: 'warn', event: 'contacts_pending' });
      expect(lines[0]?.['keys']).toContain('supportEmail');
    }
    for (const appEnv of ['local', 'ci'] as const) {
      expect(run(appEnv, NULL_CONTACTS), appEnv).toEqual([]);
    }
    const withSupport: BrandContacts = { ...NULL_CONTACTS, supportEmail: 'support@example.test' };
    const { logger, lines } = capture();
    prepareLegalDocuments({
      dir: DOCUMENTS_DIR,
      appName: APP_NAME,
      publicUrl: PUBLIC_URL,
      contacts: withSupport,
      t,
      appEnv: 'production',
      logger,
    });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>; // one JSON log line
    expect(parsed['keys']).not.toContain('supportEmail');
    expect(parsed['keys']).toContain('postalAddress');
    expect(lines.join('\n')).not.toContain('support@example.test');
  });

  it('a version that differs from LEGAL_VERSIONS stops the load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legal-documents-'));
    temporaryDirs.push(dir);
    mkdirSync(join(dir, 'en'));
    for (const page of LEGAL_PAGES) {
      copyFileSync(join(DOCUMENTS_DIR, 'en', page.file), join(dir, 'en', page.file));
    }
    const privacy = draft('privacy.md').replace(
      `version: ${LEGAL_VERSIONS.privacy_policy}`,
      'version: 2000-01-01',
    );
    writeFileSync(join(dir, 'en', 'privacy.md'), privacy);
    const error: unknown = (() => {
      try {
        loadLegalDocuments({
          dir,
          appName: APP_NAME,
          publicUrl: PUBLIC_URL,
          contacts: NULL_CONTACTS,
          t,
        });
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(DocumentError);
    expect(error).toMatchObject({ reason: 'front_matter', file: 'privacy.md' });
  });

  it('a missing file stops the load and names the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legal-documents-'));
    temporaryDirs.push(dir);
    mkdirSync(join(dir, 'en'));
    copyFileSync(join(DOCUMENTS_DIR, 'en', 'privacy.md'), join(dir, 'en', 'privacy.md'));
    expect(() =>
      loadLegalDocuments({
        dir,
        appName: APP_NAME,
        publicUrl: PUBLIC_URL,
        contacts: NULL_CONTACTS,
        t,
      }),
    ).toThrow(expect.objectContaining({ reason: 'front_matter', file: 'terms.md' }));
  });
});

describe('the page', () => {
  const chrome = {
    appName: APP_NAME,
    publicUrl: PUBLIC_URL,
    path: '/terms',
    documentTitle: `Terms of use | ${APP_NAME}`,
    effectiveDate: 'Effective date: January 2, 2026',
    footer: [
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/terms', label: 'Terms of use' },
      { href: '/content-policy', label: 'Content policy' },
    ],
  };

  it('the page carries the title, description, canonical link and the stylesheet unchanged', () => {
    const html = buildDocumentPage(
      {
        version: '2026-01-02',
        title: 'Terms of use',
        description: 'The "rules".',
        bodyHtml: '<p>x</p>',
      },
      chrome,
    );
    expect(
      html.startsWith('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">'),
    ).toBe(true);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain(`<title>Terms of use | ${APP_NAME}</title>`);
    expect(html).toContain('<meta name="description" content="The &quot;rules&quot;.">');
    expect(html).toContain('<link rel="canonical" href="https://app.example.test/terms">');
    const start = html.indexOf('<style>') + '<style>'.length;
    const end = html.indexOf('</style>');
    expect(html.slice(start, end)).toBe(DOCUMENT_PAGE_CSS);
    expect(count(html, '<style')).toBe(1);
    expect(html).toContain(
      `<header><a href="/">${APP_NAME}</a></header>\n<main><article>\n<h1>Terms of use</h1>\n<p>Effective date: January 2, 2026</p>\n<p>x</p>\n</article></main>`,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain(' class=');
    expect(html).not.toContain(' style=');
  });

  it('the footer lists the three pages in order and marks the current one', () => {
    const html = buildDocumentPage(
      { version: '2026-01-02', title: 'T', description: 'D', bodyHtml: '' },
      chrome,
    );
    expect(html).toContain(
      '<footer><a href="/privacy">Privacy policy</a><a href="/terms" aria-current="page">Terms of use</a><a href="/content-policy">Content policy</a></footer>',
    );
  });

  it('a hostile title and app name are escaped', () => {
    const html = buildDocumentPage(
      {
        version: '2026-01-02',
        title: '</title><script>x</script>',
        description: 'D',
        bodyHtml: '',
      },
      { ...chrome, appName: '<b>App</b>', documentTitle: '<t>' },
    );
    expect(html).not.toContain('<script');
    expect(html).toContain('<title>&lt;t&gt;</title>');
    expect(html).toContain('<header><a href="/">&lt;b&gt;App&lt;/b&gt;</a></header>');
  });
});

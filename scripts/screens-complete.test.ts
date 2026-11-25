import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './lib/repo-root.ts';

// TEST-screens-capture: every screen fixture has a capture entry, and every fixture entry names a
// fixture that exists. routes.ts is read as text, so its ids and paths are single-quoted literals.
// Every section of the gallery has a capture entry too; the gallery's source is read as text as
// well, so each section's kebab name is a single-quoted literal. An entry that is captured at some
// viewports only lists them as single-quoted literals, each one a viewport of the capture's config.

type RouteEntry = { id: string; path: string };
type ViewportList = { id: string; viewports: string[] };

const ROOT = repoRoot();
const ROUTES_FILE = 'apps/mobile/e2e/screens/routes.ts';
const CAPTURE_CONFIG_FILE = 'apps/mobile/playwright.screens.config.ts';
const FEATURES_DIR = 'apps/mobile/src/features';
const GALLERY_FILE = 'apps/mobile/src/features/dev/screens/gallery-screen.tsx';
const FIXTURE_PREFIX = '/dev/screens/';
/** SCR-dev-screens' `unknownPair` capture: a pair no screen registers, drawn as not found. */
const UNKNOWN_PAIR_PATH = '/dev/screens/none/none';
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The `{ id: '...', path: '...' }` pairs of a routes file, in order. */
function parseRouteEntries(source: string): RouteEntry[] {
  return [...source.matchAll(/\{\s*id:\s*'([^']*)',\s*path:\s*'([^']*)'/g)].map((match) => ({
    id: match[1] ?? '',
    path: match[2] ?? '',
  }));
}

/** How many objects of a routes file open with an `id:` value, however it is written; the type has none. */
function idFieldCount(source: string): number {
  return [...source.matchAll(/\{\s*id:(?!\s*string\b)/g)].length;
}

/** The entries of a routes file that list the viewports they are captured at, with each list in
 *  the order it is written. */
function viewportLists(source: string): ViewportList[] {
  return [
    ...source.matchAll(
      /\{\s*id:\s*'([^']*)',\s*path:\s*'[^']*',[^{}]*?\bviewports:\s*\[([^\]]*)\]/g,
    ),
  ].map((match) => ({
    id: match[1] ?? '',
    viewports: [...(match[2] ?? '').matchAll(/'([^']*)'/g)].map((each) => each[1] ?? ''),
  }));
}

/** How many objects of a routes file carry a `viewports:` value, however it is written; the type's
 *  own field is optional, `viewports?:`. */
function viewportsFieldCount(source: string): number {
  return [...source.matchAll(/\bviewports:/g)].length;
}

/** The viewports a capture config gives its projects: each `size: '<width>x<height>'`, in order. */
function captureViewports(source: string): string[] {
  return [...source.matchAll(/\bsize:\s*'(\d+x\d+)'/g)].map((match) => match[1] ?? '');
}

/** The lists that name no viewport, a viewport the capture has not, or one viewport twice. */
function badViewportLists(
  lists: readonly ViewportList[],
  viewports: readonly string[],
): ViewportList[] {
  return lists.filter(
    (list) =>
      list.viewports.length === 0 ||
      list.viewports.some((each) => !viewports.includes(each)) ||
      new Set(list.viewports).size !== list.viewports.length,
  );
}

/** The names of a fixtures module's `export const` declarations, in order. */
function fixtureExports(source: string): string[] {
  return [...source.matchAll(/^export const ([A-Za-z_$][\w$]*)/gm)].map((match) => match[1] ?? '');
}

/** The `/dev/screens/<screen>/<fixture>` part of an entry's path, or null for any other path. */
function fixturePath(path: string): { screen: string; fixture: string } | null {
  const bare = path.split('?')[0] ?? '';
  if (!bare.startsWith(FIXTURE_PREFIX)) {
    return null;
  }
  const parts = bare.slice(FIXTURE_PREFIX.length).split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    return null;
  }
  return { screen: parts[0] ?? '', fixture: parts[1] ?? '' };
}

/** The fixtures that no entry opens: no entry's path is `/dev/screens/<screen>/<that name>`. */
function missingFixtureEntries(
  fixtures: readonly string[],
  entries: readonly RouteEntry[],
): string[] {
  const opened = new Set(
    entries.flatMap((entry) => {
      const found = fixturePath(entry.path);
      return found === null ? [] : [found.fixture];
    }),
  );
  return fixtures.filter((fixture) => !opened.has(fixture));
}

/** The entries under `/dev/screens/` whose fixture does not exist, or whose path is malformed; the
 *  unknown-pair entry names no fixture on purpose. */
function danglingEntries(
  entries: readonly RouteEntry[],
  fixtures: readonly string[],
): RouteEntry[] {
  const known = new Set(fixtures);
  return entries.filter((entry) => {
    if (!entry.path.startsWith(FIXTURE_PREFIX) || entry.path === UNKNOWN_PAIR_PATH) {
      return false;
    }
    const found = fixturePath(entry.path);
    return found === null || !known.has(found.fixture);
  });
}

/** What a gallery entry's path starts with when it draws one section. */
const GALLERY_SECTION_PREFIX = '/dev/gallery?only=';
/** What follows a gallery section's path in its entry at 130% text. */
const GALLERY_TEXT_SCALE = '&textScale=1.3';
const TEXT_SCALE_ID = '-x130';

/** The gallery's one-section entries, an open overlay among them, that have no entry at 130% text:
 *  the same id followed by `-x130`, on the same path followed by `&textScale=1.3`. */
function missingGalleryTextScale(entries: readonly RouteEntry[]): RouteEntry[] {
  return entries.filter(
    (entry) =>
      entry.path.startsWith(GALLERY_SECTION_PREFIX) &&
      !entry.path.includes('textScale=') &&
      !entries.some(
        (other) =>
          other.id === `${entry.id}${TEXT_SCALE_ID}` &&
          other.path === `${entry.path}${GALLERY_TEXT_SCALE}`,
      ),
  );
}

/** The gallery's one-section entries at 130% text that repeat no entry at 100%: the id without
 *  `-x130` on the path without `&textScale=1.3`. */
function strayGalleryTextScale(entries: readonly RouteEntry[]): RouteEntry[] {
  return entries.filter(
    (entry) =>
      entry.path.startsWith(GALLERY_SECTION_PREFIX) &&
      entry.path.includes('textScale=') &&
      !(
        entry.id.endsWith(TEXT_SCALE_ID) &&
        entry.path.endsWith(GALLERY_TEXT_SCALE) &&
        entries.some(
          (other) =>
            other.id === entry.id.slice(0, -TEXT_SCALE_ID.length) &&
            other.path === entry.path.slice(0, -GALLERY_TEXT_SCALE.length),
        )
      ),
  );
}

/** What the id of a gallery section's entry starts with. */
const GALLERY_SECTION_ID = 'dev-gallery-section-';

/** The kebab names of the sections a gallery source lists, in the order they are written: the
 *  second literal of a call to one of its `...Section` helpers, or a `slug:` literal. */
function gallerySectionSlugs(source: string): string[] {
  return [
    ...source.matchAll(/\b\w*[sS]ection(?:<\w+>)?\(\s*'[^']*',\s*'([^']*)'|\bslug:\s*'([^']*)'/g),
  ].map((match) => match[1] ?? match[2] ?? '');
}

/** How many sections a gallery source lists, however each is written: every element of its
 *  `GALLERY_SECTIONS` array opens a line at the array's own indent. */
function gallerySectionCount(source: string): number {
  const list = /const GALLERY_SECTIONS\b[^=]*=\s*\[\n([\s\S]*?)\n\];/.exec(source)?.[1] ?? '';
  return [...list.matchAll(/^ {2}[A-Za-z{]/gm)].length;
}

/** The gallery sections with no entry of their own: `dev-gallery-section-<slug>` on
 *  `/dev/gallery?only=<slug>`. */
function missingGallerySections(
  slugs: readonly string[],
  entries: readonly RouteEntry[],
): string[] {
  return slugs.filter(
    (slug) =>
      !entries.some(
        (entry) =>
          entry.id === `${GALLERY_SECTION_ID}${slug}` &&
          entry.path === `${GALLERY_SECTION_PREFIX}${slug}`,
      ),
  );
}

/** The gallery's one-section entries, at either text size, whose path names no section. */
function unknownGallerySections(
  slugs: readonly string[],
  entries: readonly RouteEntry[],
): RouteEntry[] {
  const known = new Set(slugs);
  return entries.filter(
    (entry) =>
      entry.path.startsWith(GALLERY_SECTION_PREFIX) &&
      !known.has(entry.path.slice(GALLERY_SECTION_PREFIX.length).split('&')[0] ?? ''),
  );
}

/** Every `apps/mobile/src/features/*\/view-models/*.fixtures.ts`, repository-relative. */
function fixtureFiles(): string[] {
  const featuresDir = join(ROOT, FEATURES_DIR);
  return readdirSync(featuresDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((feature) => {
      const dir = join(featuresDir, feature.name, 'view-models');
      if (!existsSync(dir)) {
        return [];
      }
      return readdirSync(dir)
        .filter((name) => name.endsWith('.fixtures.ts'))
        .map((name) => `${FEATURES_DIR}/${feature.name}/view-models/${name}`);
    })
    .sort();
}

describe('the pure checks', () => {
  const ROUTES = `
    export const SCREENS: ScreenEntry[] = [
      { id: 'dev-gallery', path: '/dev/gallery', auth: 'none', prepare: waitForGallery },
      {
        id: 'hello-hello-ready',
        path: '/dev/screens/hello/helloReady',
        auth: 'none',
      },
      { id: 'hello-hello-gone', path: '/dev/screens/hello/helloGone', auth: 'none' },
      { id: 'hello-hello-ready-x130', path: '/dev/screens/hello/helloReady?textScale=1.3', auth: 'none' },
    ];
  `;

  it('parseRouteEntries reads each id and path, one line or several', () => {
    expect(parseRouteEntries(ROUTES)).toEqual([
      { id: 'dev-gallery', path: '/dev/gallery' },
      { id: 'hello-hello-ready', path: '/dev/screens/hello/helloReady' },
      { id: 'hello-hello-gone', path: '/dev/screens/hello/helloGone' },
      { id: 'hello-hello-ready-x130', path: '/dev/screens/hello/helloReady?textScale=1.3' },
    ]);
    expect(idFieldCount(ROUTES)).toBe(4);
  });

  it('counts an entry written with double quotes, which parseRouteEntries leaves out', () => {
    const source = `type ScreenEntry = { id: string; path: string };\n{ id: "dev-x", path: "/dev/x" }`;
    expect(parseRouteEntries(source)).toEqual([]);
    expect(idFieldCount(source)).toBe(1);
  });

  it('viewportLists reads the viewports an entry is captured at, and no other entry', () => {
    const source = `
      export type ScreenEntry = { id: string; path: string; viewports?: readonly ScreenViewport[] };
      export const SCREENS: ScreenEntry[] = [
        {
          id: 'dev-gallery',
          path: '/dev/gallery',
          auth: 'none',
          viewports: ['820x1180', '1440x900'],
          prepare: waitForGallery,
        },
        { id: 'dev-art', path: '/dev/art', auth: 'none' },
        { id: 'dev-wide', path: '/dev/wide', auth: 'none', viewports: ['1440x900'] },
      ];
    `;
    expect(viewportLists(source)).toEqual([
      { id: 'dev-gallery', viewports: ['820x1180', '1440x900'] },
      { id: 'dev-wide', viewports: ['1440x900'] },
    ]);
    expect(viewportsFieldCount(source)).toBe(2);
  });

  it('counts a viewport list that is no literal, which viewportLists leaves out', () => {
    const source = `
      { id: 'dev-gallery', path: '/dev/gallery', auth: 'none', viewports: WIDE },
      { id: 'dev-wide', path: '/dev/wide', auth: 'none', viewports: ['1440x900'] },
    `;
    expect(viewportLists(source)).toEqual([{ id: 'dev-wide', viewports: ['1440x900'] }]);
    expect(viewportsFieldCount(source)).toBe(2);
  });

  it('captureViewports reads the size of each viewport of a capture config', () => {
    const source = `
      const VIEWPORTS = [
        { size: '360x740', width: 360, height: 740, deviceScaleFactor: 2 },
        { size: '1440x900', width: 1440, height: 900, deviceScaleFactor: 1 },
      ] as const;
    `;
    expect(captureViewports(source)).toEqual(['360x740', '1440x900']);
  });

  it('badViewportLists reports an empty list, an unknown viewport and a repeated one', () => {
    const viewports = ['360x740', '820x1180', '1440x900'];
    const wide = { id: 'dev-gallery', viewports: ['820x1180', '1440x900'] };
    const empty = { id: 'dev-empty', viewports: [] };
    const unknown = { id: 'dev-unknown', viewports: ['1440x900', '390x844'] };
    const twice = { id: 'dev-twice', viewports: ['1440x900', '1440x900'] };
    expect(badViewportLists([wide, empty, unknown, twice], viewports)).toEqual([
      empty,
      unknown,
      twice,
    ]);
    expect(badViewportLists([wide], viewports)).toEqual([]);
  });

  it('fixtureExports reads every exported constant and nothing else', () => {
    const source = [
      "import type { HelloVm } from './hello';",
      'export type HelloFixture = HelloVm;',
      "export const helloReady: HelloVm = { status: 'ready' };",
      'const helper = 1;',
      'export const helloOffline = { ...helloReady };',
      'export function notAFixture() {}',
    ].join('\n');
    expect(fixtureExports(source)).toEqual(['helloReady', 'helloOffline']);
  });

  it('missingFixtureEntries reports a fixture with no entry', () => {
    const entries = parseRouteEntries(ROUTES);
    expect(missingFixtureEntries(['helloReady', 'helloOffline'], entries)).toEqual([
      'helloOffline',
    ]);
    expect(missingFixtureEntries(['helloReady'], entries)).toEqual([]);
  });

  it('a gallery entry or a text-scale entry does not count as a fixture of its own', () => {
    const entries = parseRouteEntries(ROUTES);
    expect(missingFixtureEntries(['gallery'], entries)).toEqual(['gallery']);
  });

  it('danglingEntries reports an entry whose fixture does not exist', () => {
    const entries = parseRouteEntries(ROUTES);
    expect(danglingEntries(entries, ['helloReady'])).toEqual([
      { id: 'hello-hello-gone', path: '/dev/screens/hello/helloGone' },
    ]);
    expect(danglingEntries(entries, ['helloReady', 'helloGone'])).toEqual([]);
  });

  it('a text-scale entry matches the fixture it opens', () => {
    const entries = [
      { id: 'hello-hello-ready-x130', path: '/dev/screens/hello/helloReady?textScale=1.3' },
    ];
    expect(missingFixtureEntries(['helloReady'], entries)).toEqual([]);
    expect(danglingEntries(entries, ['helloReady'])).toEqual([]);
  });

  it('danglingEntries does not report the unknown-pair entry', () => {
    const entries = [
      { id: 'dev-screens-unknown-pair', path: '/dev/screens/none/none' },
      { id: 'hello-none', path: '/dev/screens/hello/none' },
    ];
    expect(danglingEntries(entries, ['helloReady'])).toEqual([
      { id: 'hello-none', path: '/dev/screens/hello/none' },
    ]);
  });

  it('missingGalleryTextScale reports a gallery section or overlay with no entry at 130% text', () => {
    const section = { id: 'dev-gallery-section-text', path: '/dev/gallery?only=text' };
    const overlay = { id: 'dev-gallery-toast-error', path: '/dev/gallery?only=toast' };
    const sectionAt130 = {
      id: 'dev-gallery-section-text-x130',
      path: '/dev/gallery?only=text&textScale=1.3',
    };
    expect(missingGalleryTextScale([section, overlay, sectionAt130])).toEqual([overlay]);
    // The whole gallery and a screen's fixture are not sections of the gallery.
    expect(
      missingGalleryTextScale([
        { id: 'dev-gallery', path: '/dev/gallery' },
        { id: 'hello-hello-ready', path: '/dev/screens/hello/helloReady' },
      ]),
    ).toEqual([]);
    // The id and the path must both be the section's own.
    expect(
      missingGalleryTextScale([
        section,
        { id: 'dev-gallery-section-text-130', path: '/dev/gallery?only=text&textScale=1.3' },
      ]),
    ).toEqual([section]);
    expect(
      missingGalleryTextScale([
        section,
        { id: 'dev-gallery-section-text-x130', path: '/dev/gallery?textScale=1.3&only=text' },
      ]),
    ).toEqual([section]);
  });

  it('strayGalleryTextScale reports a 130% gallery entry that repeats no entry at 100%', () => {
    const section = { id: 'dev-gallery-section-text', path: '/dev/gallery?only=text' };
    const sectionAt130 = {
      id: 'dev-gallery-section-text-x130',
      path: '/dev/gallery?only=text&textScale=1.3',
    };
    const stray = {
      id: 'dev-gallery-section-rule-x130',
      path: '/dev/gallery?only=rule&textScale=1.3',
    };
    expect(strayGalleryTextScale([section, sectionAt130, stray])).toEqual([stray]);
    // An entry of another section's id on this section's path is not its repeat.
    const crossed = {
      id: 'dev-gallery-section-rule-x130',
      path: '/dev/gallery?only=text&textScale=1.3',
    };
    expect(strayGalleryTextScale([section, crossed])).toEqual([crossed]);
    // The whole gallery at 130% is not a section.
    expect(
      strayGalleryTextScale([{ id: 'dev-gallery-text-130', path: '/dev/gallery?textScale=1.3' }]),
    ).toEqual([]);
  });

  const GALLERY = `
    function shellsSection(): GallerySection {
      return { id: 'Shells', slug: 'shells', cell: 'full' };
    }

    function section<P extends object>(
      id: string,
      slug: string,
    ): GallerySection {
      return { id, slug };
    }

    const GALLERY_SECTIONS: readonly GallerySection[] = [
      shellsSection(),
      section('C-Text', 'text', 'wide', Text, textFixtures),
      // A specimen the gallery draws itself.
      specimenSection('C-Sheet', 'sheet', Object.keys(SHEET_STATES), (state) => {
        return <SheetSpecimen state={state} />;
      }),
      fixtureSection<PopoverProps>(
        'C-Popover',
        'popover',
        'wide',
      ),
      {
        id: 'C-IssueTile',
        slug: 'issue-tile',
        cell: 'wide',
      },
    ];
  `
    .split('\n')
    .map((line) => line.slice(4))
    .join('\n');

  it('gallerySectionSlugs reads the kebab name of a section, however the section is written', () => {
    expect(gallerySectionSlugs(GALLERY)).toEqual([
      'shells',
      'text',
      'sheet',
      'popover',
      'issue-tile',
    ]);
    expect(gallerySectionCount(GALLERY)).toBe(5);
  });

  it('counts a section whose kebab name is no literal, which gallerySectionSlugs leaves out', () => {
    const source = [
      'const GALLERY_SECTIONS: readonly GallerySection[] = [',
      "  section('C-Text', 'text', 'wide', Text, textFixtures),",
      "  section('C-Rule', RULE_SLUG, 'wide', Rule, ruleFixtures),",
      '  ruleSection(),',
      '];',
    ].join('\n');
    expect(gallerySectionSlugs(source)).toEqual(['text']);
    expect(gallerySectionCount(source)).toBe(3);
  });

  it('missingGallerySections reports a section with no entry of its own', () => {
    const entries = [
      { id: 'dev-gallery', path: '/dev/gallery' },
      { id: 'dev-gallery-section-text', path: '/dev/gallery?only=text' },
      { id: 'dev-gallery-section-text-x130', path: '/dev/gallery?only=text&textScale=1.3' },
      // An open overlay over its section, and a section's entry at 130% text, are not the
      // section's own entry.
      { id: 'dev-gallery-sheet-open', path: '/dev/gallery?only=sheet' },
      { id: 'dev-gallery-section-rule-x130', path: '/dev/gallery?only=rule&textScale=1.3' },
    ];
    expect(missingGallerySections(['text', 'sheet', 'rule'], entries)).toEqual(['sheet', 'rule']);
    expect(missingGallerySections(['text'], entries)).toEqual([]);
    // The id and the path must both be the section's own.
    expect(
      missingGallerySections(
        ['text', 'rule'],
        [
          { id: 'dev-gallery-section-text', path: '/dev/gallery?only=rule' },
          { id: 'dev-gallery-rule', path: '/dev/gallery?only=rule' },
        ],
      ),
    ).toEqual(['text', 'rule']);
  });

  it('unknownGallerySections reports a one-section entry whose path names no section', () => {
    const section = { id: 'dev-gallery-section-text', path: '/dev/gallery?only=text' };
    const overlay = { id: 'dev-gallery-sheet-open', path: '/dev/gallery?only=sheet' };
    const gone = { id: 'dev-gallery-section-gone', path: '/dev/gallery?only=gone' };
    const goneAt130 = {
      id: 'dev-gallery-section-gone-x130',
      path: '/dev/gallery?only=gone&textScale=1.3',
    };
    expect(unknownGallerySections(['text', 'sheet'], [section, overlay, gone, goneAt130])).toEqual([
      gone,
      goneAt130,
    ]);
    // The whole gallery and a screen's fixture are not sections of the gallery.
    expect(
      unknownGallerySections(
        ['text'],
        [
          { id: 'dev-gallery', path: '/dev/gallery' },
          { id: 'dev-gallery-text-130', path: '/dev/gallery?textScale=1.3' },
          { id: 'hello-hello-ready', path: '/dev/screens/hello/helloReady' },
        ],
      ),
    ).toEqual([]);
  });

  it('danglingEntries reports a malformed fixture path', () => {
    expect(danglingEntries([{ id: 'hello-x', path: '/dev/screens/hello' }], ['hello'])).toEqual([
      { id: 'hello-x', path: '/dev/screens/hello' },
    ]);
  });
});

describe('the real tree', () => {
  const source = readFileSync(join(ROOT, ROUTES_FILE), 'utf8');
  const entries = parseRouteEntries(source);
  const fixtures = fixtureFiles().flatMap((file) =>
    fixtureExports(readFileSync(join(ROOT, file), 'utf8')),
  );
  const gallerySource = readFileSync(join(ROOT, GALLERY_FILE), 'utf8');
  const gallerySlugs = gallerySectionSlugs(gallerySource);

  it('every entry is written with single-quoted id and path literals', () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBe(idFieldCount(source));
  });

  it('ids are unique and kebab-case', () => {
    const ids = entries.map((entry) => entry.id);
    expect(ids.filter((id) => !KEBAB.test(id))).toEqual([]);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it('every screen fixture has an entry', () => {
    expect(missingFixtureEntries(fixtures, entries)).toEqual([]);
  });

  it('every fixture entry names an existing fixture', () => {
    expect(danglingEntries(entries, fixtures)).toEqual([]);
  });

  it('every gallery section is written with a kebab name literal', () => {
    expect(gallerySlugs.length).toBeGreaterThan(0);
    expect(gallerySlugs.length).toBe(gallerySectionCount(gallerySource));
    expect(gallerySlugs.filter((slug) => !KEBAB.test(slug))).toEqual([]);
    expect(gallerySlugs.filter((slug, index) => gallerySlugs.indexOf(slug) !== index)).toEqual([]);
  });

  it('every gallery section has an entry, and every one-section entry names a section', () => {
    expect(missingGallerySections(gallerySlugs, entries)).toEqual([]);
    expect(unknownGallerySections(gallerySlugs, entries)).toEqual([]);
  });

  it('every gallery section and overlay entry has its entry at 130% text, and no other', () => {
    expect(entries.some((entry) => entry.path.startsWith(GALLERY_SECTION_PREFIX))).toBe(true);
    expect(missingGalleryTextScale(entries)).toEqual([]);
    expect(strayGalleryTextScale(entries)).toEqual([]);
  });

  it('every viewport list is written with literals and names viewports of the capture', () => {
    const viewports = captureViewports(readFileSync(join(ROOT, CAPTURE_CONFIG_FILE), 'utf8'));
    const lists = viewportLists(source);
    expect(viewports).toEqual(['360x740', '430x932', '820x1180', '1440x900']);
    expect(lists.length).toBe(viewportsFieldCount(source));
    expect(badViewportLists(lists, viewports)).toEqual([]);
  });

  it('the whole gallery, at either text size, is captured at the two wide viewports only', () => {
    const whole = ['dev-gallery', 'dev-gallery-text-130'];
    expect(viewportLists(source).filter((list) => whole.includes(list.id))).toEqual([
      { id: 'dev-gallery', viewports: ['820x1180', '1440x900'] },
      { id: 'dev-gallery-text-130', viewports: ['820x1180', '1440x900'] },
    ]);
  });

  it('holds the gallery and its text-scale entry', () => {
    expect(entries).toContainEqual({ id: 'dev-gallery', path: '/dev/gallery' });
    expect(entries).toContainEqual({
      id: 'dev-gallery-text-130',
      path: '/dev/gallery?textScale=1.3',
    });
  });
});

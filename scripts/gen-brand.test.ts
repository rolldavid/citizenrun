import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { BRAND, RESOURCES } from '@citizenrun/shared';
import type * as SharedModule from '@citizenrun/shared';
import {
  BrandSchema,
  NATIVE_STRING_MAP,
  renderBrandModule,
  renderNativeStrings,
} from './gen-brand.ts';
import type { Brand } from './gen-brand.ts';
import { formatText } from './lib/format.ts';
import { repoRoot } from './lib/repo-root.ts';

const ROOT = repoRoot();
const BRAND_JSON = join(ROOT, 'brand.json');
const BRAND_MODULE = join(ROOT, 'packages/shared/src/brand.ts');
const NATIVE_STRINGS = join(ROOT, 'apps/mobile/native-strings.en.json');
const CATALOG_DIR = join(ROOT, 'packages/shared/src/i18n/en');

type BrandModule = Pick<
  typeof SharedModule,
  | 'BrandValueMissingError'
  | 'brandVariant'
  | 'goHost'
  | 'mailHost'
  | 'siteOrigin'
  | 'variantForAppEnv'
>;

const scratch = mkdtempSync(join(tmpdir(), 'gen-brand-test-'));
let rendered = 0;

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function committedBrand(): Brand {
  return BrandSchema.parse(JSON.parse(readFileSync(BRAND_JSON, 'utf8')));
}

/** Renders `brand` into a temporary module and imports it. */
async function importRendered(brand: Brand): Promise<BrandModule> {
  rendered += 1;
  const file = join(scratch, `brand-${String(rendered)}.ts`);
  writeFileSync(file, renderBrandModule(brand));
  return (await import(pathToFileURL(file).href)) as BrandModule; // the rendered text is the brand module
}

/** The committed brand with every value the domain owner input gives set to null. */
function brandWithoutHosts(): Brand {
  const brand = structuredClone(committedBrand());
  brand.domain = null;
  for (const variant of Object.values(brand.variants)) {
    variant.host = null;
    variant.adminHost = null;
  }
  return brand;
}

function issuesOf(value: unknown): { path: string; message: string }[] {
  const result = BrandSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }));
}

describe('BrandSchema', () => {
  it('accepts the committed brand.json', () => {
    expect(() => committedBrand()).not.toThrow();
  });

  it('refuses a malformed brand', () => {
    const brand = committedBrand();
    const withoutStaging = {
      ...brand,
      variants: Object.fromEntries(
        Object.entries(brand.variants).filter(([name]) => name !== 'staging'),
      ),
    };
    const missing = issuesOf(withoutStaging);
    expect(missing.map((issue) => issue.path)).toEqual(['variants.staging']);

    const badScheme = structuredClone(brand);
    badScheme.variants.development.scheme = 'Bad Scheme';
    const scheme = issuesOf(badScheme);
    expect(scheme.map((issue) => issue.path)).toEqual(['variants.development.scheme']);
    for (const issue of [...missing, ...scheme]) {
      expect(issue.message.length).toBeGreaterThan(0);
      expect(issue.message).not.toContain('Bad Scheme');
    }
  });

  it('refuses an unknown key', () => {
    expect(issuesOf({ ...committedBrand(), extra: 'x' }).length).toBeGreaterThan(0);
  });

  it('refuses a wrong admin host', async () => {
    const needsHost = structuredClone(committedBrand());
    needsHost.variants.staging.host = null;
    needsHost.variants.staging.adminHost = 'admin.staging.example.test';

    const wrongPrefix = structuredClone(committedBrand());
    wrongPrefix.variants.staging.host = 'staging.example.test';
    wrongPrefix.variants.staging.adminHost = 'admin.example.test';

    const onDevelopment = structuredClone(committedBrand());
    onDevelopment.variants.development.adminHost = 'admin.dev.example.test';

    const cases: readonly (readonly [Brand, string, string])[] = [
      [needsHost, 'variants.staging.adminHost', 'adminHost needs host'],
      [wrongPrefix, 'variants.staging.adminHost', 'adminHost must be admin. followed by host'],
      [onDevelopment, 'variants.development.adminHost', 'development has no admin host'],
    ];
    for (const [brand, path, message] of cases) {
      const issues = issuesOf(brand);
      expect(issues).toEqual([{ path, message }]);
      expect(issues[0]?.message).not.toContain('example.test');
    }

    const valid = structuredClone(committedBrand());
    valid.domain = 'example.test';
    valid.variants.staging.host = 'staging.example.test';
    valid.variants.staging.adminHost = 'admin.staging.example.test';
    expect(issuesOf(valid)).toEqual([]);
    const mod = await importRendered(valid);
    expect(mod.brandVariant('staging').adminHost).toBe('admin.staging.example.test');
  });
});

describe('renderBrandModule', () => {
  it('renders a module that matches the committed one', async () => {
    const text = await formatText(BRAND_MODULE, renderBrandModule(committedBrand()));
    expect(text).toBe(readFileSync(BRAND_MODULE, 'utf8'));
    expect(text.split('\n')[0]).toBe(
      '// Generated by pnpm gen:brand from brand.json. Do not edit by hand.',
    );
  });

  it('generated helpers throw naming the key while a value is null', async () => {
    const mod = await importRendered(brandWithoutHosts());
    const cases: readonly (readonly [() => string, string])[] = [
      [() => mod.siteOrigin('staging'), 'variants.staging.host'],
      [() => mod.goHost('production'), 'variants.production.host'],
      [() => mod.mailHost(), 'domain'],
    ];
    for (const [call, key] of cases) {
      let caught: unknown = null;
      try {
        call();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(mod.BrandValueMissingError);
      expect(caught instanceof Error ? caught.message : '').toBe(
        `brand.json ${key} is not set (owner input OI-domain)`,
      );
    }
    expect(mod.brandVariant('staging').adminHost).toBeNull();
  });

  it('generated helpers build hosts from fixture values', async () => {
    const brand = brandWithoutHosts();
    brand.domain = 'example.test';
    brand.variants.staging.host = 'staging.example.test';
    const mod = await importRendered(brand);
    expect(mod.siteOrigin('staging')).toBe('https://staging.example.test');
    expect(mod.goHost('staging')).toBe('go.staging.example.test');
    expect(mod.mailHost()).toBe('mail.example.test');
    expect(mod.variantForAppEnv('ci')).toBe('development');
    expect(mod.variantForAppEnv('local')).toBe('development');
    expect(mod.variantForAppEnv('staging')).toBe('staging');
    expect(mod.variantForAppEnv('production')).toBe('production');
  });

  it('matches the brand module the shared package exports', () => {
    expect(BRAND).toEqual(committedBrand());
  });
});

describe('renderNativeStrings', () => {
  it('maps the native catalog to seven Info.plist keys', async () => {
    const native = RESOURCES.en.native;
    const text = renderNativeStrings(native);
    const parsed = JSON.parse(text) as { ios: Record<string, string> }; // the shape renderNativeStrings writes
    const plistKeys = NATIVE_STRING_MAP.map(([, plistKey]) => plistKey);
    expect(plistKeys).toHaveLength(7);
    expect(Object.keys(parsed.ios)).toEqual([...plistKeys].sort());
    expect(parsed.ios.NSCalendarsUsageDescription).toBe(native.permissions.calendar);
    expect(parsed.ios.NSCalendarsFullAccessUsageDescription).toBe(native.permissions.calendar);
    expect(parsed.ios.NSLocationWhenInUseUsageDescription).toBe(native.permissions.location);
    expect(await formatText(NATIVE_STRINGS, text)).toBe(readFileSync(NATIVE_STRINGS, 'utf8'));
  });

  it('throws naming a missing catalog key', () => {
    const { camera: _camera, ...rest } = RESOURCES.en.native.permissions;
    expect(_camera.length).toBeGreaterThan(0);
    expect(() => renderNativeStrings({ permissions: rest })).toThrow('permissions.camera');
  });
});

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap((item: unknown) => stringsIn(item));
  }
  return [];
}

function readmesUnder(dir: string): string[] {
  const found: string[] = [];
  const visit = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') {
        continue;
      }
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.name === 'README.md') {
        found.push(path);
      }
    }
  };
  visit(dir);
  return found;
}

function withoutCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('brand spelling', () => {
  it('the name is written in one casing', async () => {
    const name = BRAND.displayName;
    const secondCapital = name.slice(1).search(/[A-Z]/) + 1;
    expect(secondCapital).toBeGreaterThan(0);
    const wrongForms = [
      `${name.slice(0, secondCapital)} ${name.slice(secondCapital)}`,
      name.slice(0, 1) + name.slice(1).toLowerCase(),
      name.toUpperCase(),
    ];
    const standAloneLower = new RegExp(
      `(?<![\\w@./-])${escapeRegExp(name.toLowerCase())}(?![\\w./_-])`,
    );

    const catalogFiles = readdirSync(CATALOG_DIR).filter((file) => file.endsWith('.ts'));
    expect(catalogFiles.length).toBeGreaterThan(0);
    for (const file of catalogFiles) {
      const catalog: unknown = await import(pathToFileURL(join(CATALOG_DIR, file)).href);
      for (const value of stringsIn(catalog)) {
        expect(value, `catalog ${file}`).not.toContain(name);
      }
    }

    const documents = [
      ...['README.md', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md'].map((file) =>
        join(ROOT, file),
      ),
      ...readmesUnder(join(ROOT, 'apps')),
      ...readmesUnder(join(ROOT, 'packages')),
    ];
    for (const file of documents) {
      const text = withoutCode(readFileSync(file, 'utf8'));
      const label = relative(ROOT, file);
      for (const form of wrongForms) {
        expect(text, label).not.toContain(form);
      }
      expect(standAloneLower.test(text), label).toBe(false);
    }
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BrandSchema } from '../../gen-brand.ts';
import type { Brand } from '../../gen-brand.ts';
import { repoRoot } from '../../lib/repo-root.ts';
import { ruleTester, testable } from '../rule-tester.ts';
import {
  BRAND_FORBIDDEN,
  brandForbiddenStrings,
  brandStringIn,
  noBrandLiteral,
} from './no-brand-literal.ts';

// Every brand value is read from brand.json, never typed here.
const BRAND: Brand = BrandSchema.parse(
  JSON.parse(readFileSync(join(repoRoot(), 'brand.json'), 'utf8')),
);
const PRODUCTION = BRAND.variants.production;
const DEVELOPMENT = BRAND.variants.development;
const FILE = 'packages/shared/src/x.ts';

ruleTester().run('no-brand-literal', testable(noBrandLiteral), {
  valid: [
    {
      filename: FILE,
      code: "import { BRAND } from '@citizenrun/shared';\nexport const a = BRAND;",
    },
    { filename: FILE, code: "export const header = 'X-OS-Client';" },
    { filename: FILE, code: "export const cookie = 'os_session';" },
    { filename: FILE, code: "export const channel = 'os_events';" },
    { filename: 'scripts/gen-brand.ts', code: `export const name = '${BRAND.displayName}';` },
    { filename: FILE, code: "export const scope = '@citizenrun/shared';" },
  ],
  invalid: [
    {
      filename: FILE,
      code: `export const name = '${PRODUCTION.displayName}';`,
      errors: [{ messageId: 'brand' }],
    },
    {
      filename: FILE,
      code: `export const name = "${DEVELOPMENT.displayName}";`,
      errors: [{ messageId: 'brand' }],
    },
    {
      filename: FILE,
      code: `export const id = '${PRODUCTION.iosBundleId}';`,
      errors: [{ messageId: 'brand' }],
    },
    {
      filename: FILE,
      code: `export const link = \`${PRODUCTION.scheme}://open\`;`,
      errors: [{ messageId: 'brand' }],
    },
    {
      filename: 'apps/mobile/src/features/x/a.tsx',
      code: `declare const Text: (props: object) => null;\nexport const a = <Text>${BRAND.displayName}</Text>;`,
      errors: [{ messageId: 'brand' }],
    },
    {
      filename: FILE,
      code: `export const pkg = '${DEVELOPMENT.androidPackage}';`,
      errors: [{ messageId: 'brand' }],
    },
  ],
});

/** The committed brand with the domain and every host and admin host unset. */
const UNHOSTED: Brand = {
  ...BRAND,
  domain: null,
  variants: {
    development: { ...BRAND.variants.development, host: null, adminHost: null },
    staging: { ...BRAND.variants.staging, host: null, adminHost: null },
    production: { ...BRAND.variants.production, host: null, adminHost: null },
  },
};

describe('brandForbiddenStrings', () => {
  it('forbids no host while every host and the domain are null', () => {
    const expected = new Set<string>([UNHOSTED.displayName]);
    for (const variant of Object.values(UNHOSTED.variants)) {
      expected.add(variant.displayName);
      expected.add(variant.iosBundleId);
      expected.add(variant.androidPackage);
      expected.add(`${variant.scheme}://`);
    }
    expect(new Set(brandForbiddenStrings(UNHOSTED))).toEqual(expected);
  });

  it('the rule forbids the strings of the committed brand.json, its set hosts among them', () => {
    expect(new Set(BRAND_FORBIDDEN)).toEqual(new Set(brandForbiddenStrings(BRAND)));
    const written = [
      BRAND.domain,
      ...Object.values(BRAND.variants).flatMap((variant) => [variant.host, variant.adminHost]),
    ].filter((value): value is string => value !== null);
    for (const value of written) {
      expect(BRAND_FORBIDDEN).toContain(value);
    }
  });

  it('adds the domain, the hosts and the derived mail and go hosts once they are set', () => {
    const fixture: Brand = {
      ...BRAND,
      domain: 'example.test',
      variants: {
        ...BRAND.variants,
        staging: {
          ...BRAND.variants.staging,
          host: 'staging.example.test',
          adminHost: 'admin.staging.example.test',
        },
      },
    };
    const forbidden = brandForbiddenStrings(fixture);
    expect(forbidden).toContain('example.test');
    expect(forbidden).toContain('mail.example.test');
    expect(forbidden).toContain('staging.example.test');
    expect(forbidden).toContain('go.staging.example.test');
    expect(forbidden).toContain('admin.staging.example.test');
  });

  it('never reports the protocol names', () => {
    expect(brandStringIn('X-OS-Client os_session os_events', ['os_'])).toBeNull();
    expect(brandStringIn(`a ${BRAND.displayName} b`, BRAND_FORBIDDEN)).toBe(BRAND.displayName);
  });
});

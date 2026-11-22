import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { writeFormatted } from './lib/format.ts';
import { repoRoot } from './lib/repo-root.ts';

const SCHEME = /^[a-z][a-z0-9-]*$/;
const BUNDLE_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
const HOST =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const VARIANT_NAMES = ['development', 'staging', 'production'] as const;

const text = z.string().min(1, { message: 'must be a non-empty string' });
const ownerValue = text.nullable();
const host = z.string().regex(HOST, { message: 'must be a lower-case host name' }).nullable();

const VariantSchema = z.strictObject({
  displayName: text,
  scheme: z.string().regex(SCHEME, { message: 'must be a lower-case scheme' }),
  iosBundleId: z.string().regex(BUNDLE_ID, { message: 'must be a lower-case bundle id' }),
  androidPackage: z.string().regex(BUNDLE_ID, { message: 'must be a lower-case package name' }),
  host,
  adminHost: host,
  appleServicesId: ownerValue,
});

/** The exact shape of brand.json; a `null` is an owner input that does not exist yet. */
export const BrandSchema = z
  .strictObject({
    displayName: text,
    slug: text,
    domain: host,
    expo: z.strictObject({ owner: ownerValue, projectId: ownerValue }),
    github: z.strictObject({ repository: text }),
    contacts: z.strictObject({
      supportEmail: ownerValue,
      postalAddress: ownerValue,
      dmcaAgent: z.strictObject({
        name: ownerValue,
        address: ownerValue,
        phone: ownerValue,
        email: ownerValue,
      }),
      childSafetyContact: z.strictObject({ name: ownerValue, email: ownerValue }),
    }),
    variants: z.strictObject({
      development: VariantSchema,
      staging: VariantSchema,
      production: VariantSchema,
    }),
  })
  .superRefine((brand, ctx) => {
    // D-798: the admin host is `admin.` followed by the variant's host, and development has none.
    for (const name of VARIANT_NAMES) {
      const variant = brand.variants[name];
      if (variant.adminHost === null) {
        continue;
      }
      const path = ['variants', name, 'adminHost'];
      if (name === 'development') {
        ctx.addIssue({ code: 'custom', path, message: 'development has no admin host' });
      } else if (variant.host === null) {
        ctx.addIssue({ code: 'custom', path, message: 'adminHost needs host' });
      } else if (variant.adminHost !== `admin.${variant.host}`) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'adminHost must be admin. followed by host',
        });
      }
    }
  });

export type Brand = z.infer<typeof BrandSchema>;

/** Catalog key of the `native` namespace to the iOS Info.plist key it fills (PM-native-strings). */
export const NATIVE_STRING_MAP = [
  ['permissions.location', 'NSLocationWhenInUseUsageDescription'],
  ['permissions.calendarWriteOnly', 'NSCalendarsWriteOnlyAccessUsageDescription'],
  ['permissions.calendar', 'NSCalendarsUsageDescription'],
  ['permissions.calendar', 'NSCalendarsFullAccessUsageDescription'],
  ['permissions.photos', 'NSPhotoLibraryUsageDescription'],
  ['permissions.camera', 'NSCameraUsageDescription'],
  ['permissions.microphone', 'NSMicrophoneUsageDescription'],
] as const;

const BRAND_MODULE_PATH = 'packages/shared/src/brand.ts';
const NATIVE_STRINGS_PATH = 'apps/mobile/native-strings.en.json';
const NATIVE_CATALOG_PATH = 'packages/shared/src/i18n/en/native.ts';

const BRAND_MODULE_BODY = `
export type BrandVariantName = 'development' | 'staging' | 'production';

export type BrandVariant = {
  displayName: string;
  scheme: string;
  iosBundleId: string;
  androidPackage: string;
  host: string | null;
  adminHost: string | null;
  appleServicesId: string | null;
};

export type BrandContacts = {
  supportEmail: string | null;
  postalAddress: string | null;
  dmcaAgent: { name: string | null; address: string | null; phone: string | null; email: string | null };
  childSafetyContact: { name: string | null; email: string | null };
};

/** A brand value the owner has not given yet; the message names the key and its owner input. */
export class BrandValueMissingError extends Error {
  constructor(key: string, ownerInput: string) {
    super(\`brand.json \${key} is not set (owner input \${ownerInput})\`);
    this.name = 'BrandValueMissingError';
  }
}

/** The identifiers of one variant; \`host\` and \`adminHost\` are null until the owner gives them. */
export function brandVariant(name: BrandVariantName): BrandVariant {
  return BRAND.variants[name];
}

/** The variant a process runs as: \`local\` and \`ci\` run as development. */
export function variantForAppEnv(appEnv: 'local' | 'ci' | 'staging' | 'production'): BrandVariantName {
  if (appEnv === 'local' || appEnv === 'ci') {
    return 'development';
  }
  return appEnv;
}

function brandDomain(): string | null {
  return BRAND.domain;
}

function variantHost(name: BrandVariantName): string {
  const host = brandVariant(name).host;
  if (host === null) {
    throw new BrandValueMissingError(\`variants.\${name}.host\`, 'OI-domain');
  }
  return host;
}

/** \`https://<host>\` of a variant; throws BrandValueMissingError while its host is null. */
export function siteOrigin(name: BrandVariantName): string {
  return \`https://\${variantHost(name)}\`;
}

/** The one sending host, \`mail.<domain>\`; throws BrandValueMissingError while the domain is null. */
export function mailHost(): string {
  const domain = brandDomain();
  if (domain === null) {
    throw new BrandValueMissingError('domain', 'OI-domain');
  }
  return \`mail.\${domain}\`;
}

/** The open-in-app host of a variant, \`go.<host>\`; throws BrandValueMissingError while its host is null. */
export function goHost(name: BrandVariantName): string {
  return \`go.\${variantHost(name)}\`;
}
`;

/** The TypeScript text of the brand module (unformatted): BRAND as a literal and its helpers. */
export function renderBrandModule(brand: Brand): string {
  return [
    '// Generated by pnpm gen:brand from brand.json. Do not edit by hand.',
    '',
    `export const BRAND = ${JSON.stringify(brand, null, 2)} as const;`,
    BRAND_MODULE_BODY,
  ].join('\n');
}

/**
 * The JSON text of `native-strings.en.json` (unformatted): `{ "ios": { <Info.plist key>: text } }`
 * with sorted keys. Throws naming the catalog key when one is missing.
 */
export function renderNativeStrings(native: {
  permissions: Readonly<Record<string, string>>;
}): string {
  const ios: Record<string, string> = {};
  for (const [catalogKey, plistKey] of NATIVE_STRING_MAP) {
    const value = native.permissions[catalogKey.slice('permissions.'.length)];
    if (value === undefined) {
      throw new Error(`the native catalog has no key ${catalogKey}`);
    }
    ios[plistKey] = value;
  }
  const sorted = Object.fromEntries(
    Object.entries(ios).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return `${JSON.stringify({ ios: sorted }, null, 2)}\n`;
}

const NativeModuleSchema = z.object({
  native: z.object({ permissions: z.record(z.string(), z.string().min(1)) }),
});

async function main(): Promise<void> {
  const root = repoRoot();
  const raw: unknown = JSON.parse(await readFile(join(root, 'brand.json'), 'utf8'));
  const parsed = BrandSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      console.error(`brand.json ${issue.path.map(String).join('.')}:`, issue.message);
    }
    process.exit(1);
  }
  // A dynamic import, so the generator runs while brand.ts is missing or stale.
  const catalog = NativeModuleSchema.parse(
    await import(pathToFileURL(join(root, NATIVE_CATALOG_PATH)).href),
  );
  await writeFormatted(join(root, BRAND_MODULE_PATH), renderBrandModule(parsed.data));
  await writeFormatted(join(root, NATIVE_STRINGS_PATH), renderNativeStrings(catalog.native));
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  await main();
}

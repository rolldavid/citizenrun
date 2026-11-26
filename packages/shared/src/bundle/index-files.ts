import { z } from 'zod';
import { BUNDLE_SCHEMA_VERSION, IsoInstantSchema } from './common.ts';

const PublishedVersion = z.string().regex(/^\d{8}T\d{6}Z-(full|filings|geometry)$/); // never a sample- version (D-458)

/** bundles/index/full.json, filings.json, geometry.json: the newest published manifest of one kind. */
export const BundlePointerSchema = z
  .strictObject({
    kind: z.enum(['full', 'filings', 'geometry']),
    version: PublishedVersion,
    manifest: z.string().regex(/^bundles\/\d{8}T\d{6}Z-(full|filings|geometry)\/manifest\.json$/),
    published_at: IsoInstantSchema,
  })
  .refine(
    (p) => p.version.endsWith(`-${p.kind}`) && p.manifest === `bundles/${p.version}/manifest.json`,
    'pointer kind, version and manifest disagree',
  );
export type BundlePointer = z.infer<typeof BundlePointerSchema>;

/** bundles/index/loader.json, written by J-bundle.poll at each run. */
export const LoaderInfoSchema = z.strictObject({
  schema_version: z.literal(BUNDLE_SCHEMA_VERSION),
  schema_revision: z.int().min(0),
  updated_at: IsoInstantSchema,
});
export type LoaderInfo = z.infer<typeof LoaderInfoSchema>;

/** ai-ledger/<yyyy-mm>/pipeline-total.json; the same shape as the worker's worker.json (J-ai.ledger-sync). */
export const AiMonthTotalSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  settled_micro_usd: z.int().min(0),
  reserved_micro_usd: z.int().min(0),
  updated_at: IsoInstantSchema,
});
export type AiMonthTotal = z.infer<typeof AiMonthTotalSchema>;

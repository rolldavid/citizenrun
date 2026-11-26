// The stage-internal file `person_sources.ndjson.gz`: the photo pointers of each person of the
// known bodies, read by the photo stage (PIPE-people-photos). It is never a bundle file.
import { SafeUrlSchema, SourceKeySchema, text } from '@citizenrun/shared';
import { z } from 'zod';

export const PersonSourceRowSchema = z.strictObject({
  person_key: SourceKeySchema,
  bioguide: z
    .string()
    .regex(/^[A-Z]\d{6}$/)
    .nullable(),
  wikipedia_urls: z.array(SafeUrlSchema).max(10), // https://en.wikipedia.org/wiki/... found in links or sources, in source order
  wikidata_qid: z
    .string()
    .regex(/^Q\d+$/)
    .nullable(),
  nickname_alias: text(200).nullable(), // `<nickname> <last_name>` for Congress
});
export type PersonSourceRow = z.infer<typeof PersonSourceRowSchema>;

/** The name given to `writeRows` for this file. */
export const PERSON_SOURCES_FILE = 'person_sources';

// The certification dates of a state's elections (PIPE-deadlines step 4, D-322): a stage-internal
// file the results stage reads, never a bundle file.
import type { Computed } from '@citizenrun/rules';
import { IsoDateSchema, SafeUrlSchema, SourceKeySchema, text } from '@citizenrun/shared';
import type { BElection } from '@citizenrun/shared';
import { z } from 'zod';

export const CertificationRowSchema = z.strictObject({
  election_key: SourceKeySchema,
  date: IsoDateSchema,
  citation: text(300),
  source_url: SafeUrlSchema,
  quote: text(2000),
});
export type CertificationRow = z.infer<typeof CertificationRowSchema>;

/** The name given to `writeRows` for this file. */
export const CERTIFICATION_FILE = 'certification';

/** One row for an election whose certification date the rules module computes. */
export function certificationRow(
  election: BElection,
  computed: Computed<string>,
): CertificationRow {
  return CertificationRowSchema.parse({
    election_key: election.source_key,
    date: computed.value,
    citation: computed.citation.citation,
    source_url: computed.citation.sourceUrl,
    quote: computed.citation.quote,
  });
}

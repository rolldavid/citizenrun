// Two made-up stage 2 office references for the fixture state ZZ: State Senate districts 1 and 2,
// elected in groups A and B on the fixture state schedule.
import { OfficeRefRowSchema } from '../../stages/shared/office-ref.ts';
import type { OfficeRefRow } from '../../stages/shared/office-ref.ts';

function senate(n: 1 | 2, group: 'A' | 'B', first: number): OfficeRefRow {
  const district = `tiger:sldu:9900${String(n)}`;
  return OfficeRefRowSchema.parse({
    slug: `zz-state-senator-district-${String(n)}`,
    identity: `state:ZZ|state-senate|${district}`,
    origin: 's02-known',
    template_key: null,
    office_type_id: 'state-senate',
    jurisdiction_key: 'state:ZZ',
    jurisdiction_kind: 'state',
    district_key: district,
    county_geoid: null,
    party: null,
    party_selection: null,
    partisan: true,
    schedule: 'zz_state_general',
    track_set: 'zz_partisan',
    stagger: [{ group, seats: 1, every: 4, first }],
    stagger_group: group,
    seats: 1,
    body_size: null,
    term_years: 4,
    pay_annual_cents: null,
    pay_range: null,
    template_seats: null,
    population: null,
  });
}

export const ZZ_KNOWN_REFS: readonly OfficeRefRow[] = [senate(1, 'A', 2026), senate(2, 'B', 2028)];

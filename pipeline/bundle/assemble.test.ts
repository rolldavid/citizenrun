import { describe, expect, it } from 'vitest';
import { assemble, combineRows } from './assemble.ts';
import { integrityCheck } from './checks.ts';
import type { BundleInputs, StateInputs } from './inputs.ts';
import {
  district,
  geometry,
  holder,
  jurisdiction,
  office,
  person,
  stageMeta,
  stateInputs,
} from './testing/rows.ts';

const PHOTO = {
  asset: `../../assets/photos/${'b'.repeat(64)}.jpg`,
  width: 320,
  height: 391,
  source_url: 'https://example.test/zz/portrait',
  author: 'Fixture Author',
  license: 'CC0-1.0' as const,
  license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  credit_text: 'Fixture Author · CC0',
  modified: true,
  retrieved_at: '2026-11-01T00:00:00.000Z',
};

function inputs(state: StateInputs): BundleInputs {
  return {
    states: [state],
    missing: [],
    zipCentroids: [],
    zipMeta: null,
    givenNameAliases: [],
    givenNameMeta: null,
    listingWebsites: new Map(),
    boundarySources: [],
  };
}

describe('assemble', () => {
  it('a stage 9 person replaces the stage 2 row and adds the photo', () => {
    const senator = person('bioguide:Z000001');
    const withPhoto = person('bioguide:Z000001', { photo: PHOTO });
    const out = assemble(
      inputs(
        stateInputs({
          known: { people: [senator] },
          people: {
            people: [withPhoto],
            assets: [
              {
                path: `assets/photos/${'b'.repeat(64)}.jpg`,
                sha256: 'b'.repeat(64),
                bytes: 100,
                width: 320,
                height: 391,
                content_type: 'image/jpeg',
              },
              {
                path: `assets/photos/${'c'.repeat(64)}.jpg`,
                sha256: 'c'.repeat(64),
                bytes: 100,
                width: 320,
                height: 391,
                content_type: 'image/jpeg',
              },
            ],
          },
        }),
      ),
    );
    expect(out.states[0]?.rows.people).toEqual([withPhoto]);
    expect(out.assets.map((asset) => asset.sha256)).toEqual(['b'.repeat(64)]);
  });

  it('a stage 9 person not in stage 2 and holding no kept office is left out', () => {
    const out = assemble(inputs(stateInputs({ people: { people: [person('wikidata:Q1')] } })));
    expect(out.states[0]?.rows.people).toEqual([]);
  });

  it('a stage 9 holder of a missing office is dropped and counted', () => {
    const governor = person('wikidata:Q2');
    const out = assemble(
      inputs(
        stateInputs({
          expand: { meta: stageMeta('s04-expand'), offices: [office('zz-governor')] },
          people: {
            people: [governor, person('wikidata:Q3')],
            officeholders: [holder('zz-governor', 'wikidata:Q2'), holder('zz-gone', 'wikidata:Q3')],
          },
        }),
      ),
    );
    const state = out.states[0];
    expect(state?.rows.officeholders.map((h) => h.office_key)).toEqual(['zz-governor']);
    expect(state?.rows.people.map((p) => p.source_key)).toEqual(['wikidata:Q2']);
    expect(state?.counts['holder_office_missing']).toBe(1);
  });

  it("a key in two stages' jurisdictions fails integrity", () => {
    const out = assemble(
      inputs(
        stateInputs({
          base: {
            jurisdictions: [jurisdiction('state:ZZ', { kind: 'state' }), jurisdiction('coop:1')],
          },
          coops: { meta: stageMeta('s02-coops'), jurisdictions: [jurisdiction('coop:1')] },
        }),
      ),
    );
    const rows = combineRows(out.states);
    expect(rows.jurisdictions.map((j) => j.source_key)).toEqual(['state:ZZ', 'coop:1', 'coop:1']);
    const check = integrityCheck(rows, new Map());
    expect(check.passed).toBe(false);
    expect(check.detail).toContain('duplicate.jurisdictions=1 (coop:1)');
  });

  it('the legislator with no office link stays a person', () => {
    const unmapped = person('openstates:ocd-person/zz-9');
    const out = assemble(inputs(stateInputs({ known: { people: [unmapped] } })));
    expect(out.states[0]?.rows.people).toEqual([unmapped]);
    expect(out.states[0]?.rows.officeholders).toEqual([]);
  });

  it('records the owning stage of each row and drops facts whose row is missing', () => {
    const out = assemble(
      inputs(
        stateInputs({
          base: { districts: [district('tiger:state:99')], geometry: [geometry('tiger:state:99')] },
          expand: {
            meta: stageMeta('s04-expand', 'ZZ', { finished_at: '2026-11-20T00:00:00.000Z' }),
            offices: [office('zz-a')],
          },
          deadlines: {
            meta: stageMeta('s05-deadlines'),
            facts: [
              {
                table: 'offices',
                key: 'zz-a',
                field: 'filing_fee_cents',
                value: 1,
                origin: 's05-deadlines',
                evidence: {
                  kind: 'computed',
                  value: 1,
                  source_url: null,
                  quote: null,
                  rule_citation: null,
                  checked_at: '2026-11-01T00:00:00.000Z',
                },
              },
              {
                table: 'offices',
                key: 'zz-missing',
                field: 'filing_fee_cents',
                value: 1,
                origin: 's05-deadlines',
                evidence: {
                  kind: 'computed',
                  value: 1,
                  source_url: null,
                  quote: null,
                  rule_citation: null,
                  checked_at: '2026-11-01T00:00:00.000Z',
                },
              },
            ],
          },
        }),
      ),
    );
    const state = out.states[0];
    expect(state?.origins.get('offices|zz-a')).toEqual({
      origin: 's04-expand',
      finishedAt: '2026-11-20T00:00:00.000Z',
    });
    expect(state?.facts.map((f) => f.key)).toEqual(['zz-a']);
    expect(state?.counts['fact_row_missing']).toBe(1);
    expect(out.geometry.get('ZZ')?.map((g) => g.source_key)).toEqual(['tiger:state:99']);
  });
});

import type { Citation } from '@citizenrun/rules';
import type { FieldMetaRow } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import {
  EvidenceOriginError,
  computedEvidence,
  datasetEvidence,
  metaToEvidence,
  statuteEvidence,
  templateDefaultEvidence,
} from './evidence.ts';

const CITATION: Citation = {
  citation: 'ZZ Fixture Code 105',
  sourceUrl: 'https://example.test/zz/code',
  quote:
    'Fixture text: a party candidate files from the 90th day to the 60th day before the primary.',
  validFrom: '2000-01-01',
  validTo: null,
};
const NOW = new Date('2026-11-16T12:00:00.000Z');
const FINISHED = '2026-11-16T11:00:00.000Z';

const meta = (confidence: FieldMetaRow['confidence']): FieldMetaRow => ({
  source_url: 'https://example.test/zz/code',
  quote: 'Fixture text: the board has five members.',
  confidence,
  checked_at: '2026-11-01T00:00:00.000Z',
  rule_citation: 'ZZ Fixture Code 2',
});

describe('evidence builders', () => {
  it('computedEvidence takes the fixture retrieval date at midnight and the citation', () => {
    expect(computedEvidence('2026-03-06', CITATION, '2026-11-15', NOW)).toEqual({
      kind: 'computed',
      value: '2026-03-06',
      source_url: 'https://example.test/zz/code',
      quote: CITATION.quote,
      rule_citation: 'ZZ Fixture Code 105',
      checked_at: '2026-11-15T00:00:00.000Z',
    });
  });

  it('computedEvidence takes now when the state has no fixture', () => {
    expect(computedEvidence(1, CITATION, null, NOW).checked_at).toBe('2026-11-16T12:00:00.000Z');
  });

  it('dataset, statute and template default evidence carry their kind and proof', () => {
    const proof = {
      source_url: 'https://example.test/zz/data',
      quote: 'row',
      checked_at: FINISHED,
    };
    expect(datasetEvidence(5, proof)).toEqual({
      kind: 'dataset',
      value: 5,
      ...proof,
      rule_citation: null,
    });
    expect(statuteEvidence(5, { ...proof, rule_citation: 'ZZ Fixture Code 2' }).kind).toBe(
      'statute',
    );
    expect(templateDefaultEvidence(3, FINISHED)).toEqual({
      kind: 'template_default',
      value: 3,
      source_url: null,
      quote: null,
      rule_citation: null,
      checked_at: FINISHED,
    });
  });
});

describe('metaToEvidence', () => {
  it('maps each origin to its kind', () => {
    for (const origin of ['s01-base', 's02-known', 's02-coops', 's09-people'] as const) {
      expect(metaToEvidence('offices', origin, 5, meta('medium'), FINISHED).kind).toBe('dataset');
    }
    expect(metaToEvidence('offices', 's04-expand', 5, meta('medium'), FINISHED).kind).toBe(
      'statute',
    );
    expect(metaToEvidence('offices', 's04-expand', 5, meta('high'), FINISHED).kind).toBe('statute');
    expect(
      metaToEvidence('filing_tracks', 's05-deadlines', '2026-03-06', meta('medium'), FINISHED).kind,
    ).toBe('computed');
  });

  it('a low expand value is a template default', () => {
    expect(metaToEvidence('offices', 's04-expand', 5, meta('low'), FINISHED).kind).toBe(
      'template_default',
    );
    expect(metaToEvidence('offices', 's04-expand', 5, undefined, FINISHED).kind).toBe(
      'template_default',
    );
  });

  it('takes the proof from the meta entry, or nulls and the finish time without one', () => {
    expect(metaToEvidence('offices', 's02-coops', 9, meta('medium'), FINISHED)).toEqual({
      kind: 'dataset',
      value: 9,
      source_url: 'https://example.test/zz/code',
      quote: 'Fixture text: the board has five members.',
      rule_citation: 'ZZ Fixture Code 2',
      checked_at: '2026-11-01T00:00:00.000Z',
    });
    expect(metaToEvidence('offices', 's02-known', 1, undefined, FINISHED)).toEqual({
      kind: 'dataset',
      value: 1,
      source_url: null,
      quote: null,
      rule_citation: null,
      checked_at: FINISHED,
    });
  });

  it('refuses a stage with no evidence kind', () => {
    expect(() => metaToEvidence('offices', 's06-extract', 1, undefined, FINISHED)).toThrow(
      EvidenceOriginError,
    );
  });
});

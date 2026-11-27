import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OFFICE } from '../__fixtures__/office.fixtures.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import { officeWith, t } from '../regions/testing/support.ts';
import { issueMatchLine } from './header.ts';

beforeAll(() => {
  setStrictGlyphs(true);
});

describe('issueMatchLine', () => {
  it('issue match line', () => {
    // Two matches, in the office's order, not the viewer's.
    expect(issueMatchLine(FIXTURE_OFFICE, ['public-money', 'property-taxes'], t)).toBe(
      'Matches Property taxes and Public money',
    );
    expect(issueMatchLine(FIXTURE_OFFICE, ['property-taxes', 'housing'], t)).toBe(
      'Matches Property taxes',
    );
    expect(issueMatchLine(FIXTURE_OFFICE, ['housing'], t)).toBe('County office');
    expect(issueMatchLine(FIXTURE_OFFICE, [], t)).toBe('County office');
    // Nobody signed in.
    expect(issueMatchLine(FIXTURE_OFFICE, null, t)).toBe('County office');

    const approx = officeWith({
      district: { ...FIXTURE_OFFICE.district, geometryQuality: 'county_approx' },
    });
    expect(issueMatchLine(approx, ['property-taxes'], t)).toBe(
      'May include you. Check your district.',
    );
  });

  it('names two issues at most and no issue this build does not know', () => {
    const three = officeWith({
      issues: [
        { issueId: 'fixture-issue', relevance: 3 },
        { issueId: 'property-taxes', relevance: 3 },
        { issueId: 'public-money', relevance: 2 },
        { issueId: 'housing', relevance: 1 },
      ],
    });
    expect(
      issueMatchLine(three, ['housing', 'public-money', 'property-taxes', 'fixture-issue'], t),
    ).toBe('Matches Property taxes and Public money');
  });
});

import {
  CardCanvas,
  buildRunAgainstModel,
  canvasColorsFrom,
  runAgainstAltText,
} from '@citizenrun/cards';
import type { CanvasPage, RunAgainstData } from '@citizenrun/cards';
import type { OfficeSummary, TFunction } from '@citizenrun/shared';
import { useMemo } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/ui/components/skeleton';
import { useFontsReady } from '@/ui/fonts';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { issue } from '@/ui/tokens';

// The canvas the card fixtures draw. Every person and place here is invented: place names start
// with "Fixture", and ZZ is no state.

/** The fixed instant the fixture canvas is built at: 9 am on November 15, 2026 in the fixture county. */
export const FIXTURE_NOW = new Date('2026-11-15T17:00:00Z');

export type FixtureCanvasVariant = 'known' | 'allUnknown';

const CHECKED_AT = '2026-11-09T15:00:00Z';

/** The County Treasurer of Fixture Wren County, ZZ: every act-on value known. */
const KNOWN_OFFICE: OfficeSummary = {
  id: 'fixture-office-1',
  slug: 'fixture-county-treasurer',
  title: 'County Treasurer',
  officeTypeId: 'county-treasurer',
  level: 'county',
  electorate: 'public',
  state: 'ZZ',
  jurisdiction: {
    id: 'fixture-jurisdiction-1',
    name: 'Fixture Wren County',
    kind: 'county',
    state: 'ZZ',
    website: null,
    timezone: 'America/Los_Angeles',
  },
  district: {
    id: 'fixture-district-1',
    tileId: 1,
    name: 'Fixture Wren County',
    level: 'county',
    geometryQuality: 'exact',
  },
  outline: null,
  placeholder: false,
  completeness: null,
  partisan: false,
  seats: 1,
  bodySize: null,
  seatsUpNext: 1,
  payAnnualCents: 5290000,
  payKind: 'salary',
  payAmountCents: 5290000,
  payPeriod: 'year',
  hoursPerWeek: 20,
  fitsDayJob: 'likely',
  fullTime: false,
  signaturesRequired: null,
  filingFeeCents: 5000,
  costToRunCents: null,
  ease: null,
  easeConfidence: null,
  impact: null,
  impactMode: 'personal',
  impactIssueId: null,
  opportunity: null,
  votesToWin: 2100,
  votesLow: 1800,
  votesHigh: 2400,
  votesEstimated: true,
  nextElection: {
    id: 'fixture-election-1',
    electionDate: '2027-04-06',
    kind: 'general',
    party: null,
  },
  filingDeadline: { date: '2026-11-27', time: null, timezone: 'America/Los_Angeles' },
  filingStatus: 'open',
  headlineIssueId: 'property-taxes',
  issues: [
    { issueId: 'property-taxes', relevance: 3 },
    { issueId: 'public-money', relevance: 2 },
  ],
  featuredOfficeholder: {
    id: 'fixture-person-1',
    slug: 'fixture-carol-wynn',
    name: 'Carol Wynn',
    party: null,
    photo: null,
    photoCredit: null,
    claimed: false,
    rosterOnly: false,
    retiredAt: null,
    viewer: { following: false },
  },
  featuredHolderSince: '2019-01-07',
  openSeat: null,
  fieldMeta: {
    payAnnualCents: {
      sourceUrl: 'https://elections.wrencounty.example/budget-2026',
      quote: 'The treasurer is paid $52,900 a year.',
      confidence: 'high',
      checkedAt: CHECKED_AT,
      ruleCitation: null,
    },
    // A proof at low confidence has no link and no quote.
    hoursPerWeek: {
      sourceUrl: null,
      quote: null,
      confidence: 'low',
      checkedAt: CHECKED_AT,
      ruleCitation: null,
    },
    filingDeadline: {
      sourceUrl: 'https://elections.wrencounty.example/calendar',
      quote: 'Filing closes November 27.',
      confidence: 'medium',
      checkedAt: CHECKED_AT,
      ruleCitation: null,
    },
  },
  retiredAt: null,
  viewer: { following: false, bookmarked: false, running: false, declarationId: null },
};

/** The same office with every act-on value null. The election stays, so the canvas keeps its election line. */
const ALL_UNKNOWN_OFFICE: OfficeSummary = {
  ...KNOWN_OFFICE,
  payAnnualCents: null,
  payKind: null,
  payAmountCents: null,
  payPeriod: null,
  hoursPerWeek: null,
  fitsDayJob: null,
  fullTime: null,
  filingFeeCents: null,
  votesToWin: null,
  votesLow: null,
  votesHigh: null,
  votesEstimated: null,
  filingDeadline: null,
  filingStatus: 'dates_not_known',
  featuredOfficeholder: null,
  featuredHolderSince: null,
  headlineIssueId: null,
  issues: [],
  fieldMeta: {},
};

const OFFICES: Readonly<Record<FixtureCanvasVariant, OfficeSummary>> = {
  known: KNOWN_OFFICE,
  allUnknown: ALL_UNKNOWN_OFFICE,
};

/** The run-against fixture office of the cards package, written out (the app may not import another package's src). */
export function fixtureOffice(variant: FixtureCanvasVariant): OfficeSummary {
  return OFFICES[variant];
}

/** The data of the fixture canvas: the office's featured officeholder is the holder shown. */
function fixtureRunAgainstData(variant: FixtureCanvasVariant): RunAgainstData {
  const office = fixtureOffice(variant);
  return { office, featuredPerson: office.featuredOfficeholder, lastResult: null };
}

/** The canvas of that office in the active theme at the layout's canvas width. */
export function FixtureRunAgainstCanvas({
  variant,
}: {
  variant: FixtureCanvasVariant;
}): JSX.Element {
  const theme = useTheme();
  const { canvasWidth } = useBreakpoint();
  const { t, i18n } = useTranslation();
  const fontsReady = useFontsReady();
  const locale = i18n.language;

  // One canvas for each theme and width (D-178).
  const canvas = useMemo(() => {
    // The typed t accepts catalog keys only; the builders pass each key as a plain string.
    const translate = t as unknown as TFunction;
    const colors = canvasColorsFrom(theme.name, theme.color, issue);
    const ctx = { locale, now: FIXTURE_NOW };
    const data = fixtureRunAgainstData(variant);
    const model = buildRunAgainstModel(data, translate, ctx, {
      stickerAllowed: false,
      photoHrefFor: () => null,
    });
    const page: CanvasPage = {
      key: data.office.id,
      officeId: data.office.id,
      template: 'run_against',
      model,
      alt: runAgainstAltText(data, translate, ctx),
    };
    return <CardCanvas page={page} colors={colors} width={canvasWidth} />;
  }, [theme, canvasWidth, t, locale, variant]);

  // A canvas is never drawn in a fallback face: its lines were placed for the four faces.
  return fontsReady ? canvas : <Skeleton shape="canvas" />;
}

/** The English alt text of that canvas. */
export const FIXTURE_ALT_TEXT: Readonly<Record<FixtureCanvasVariant, string>> = {
  known:
    'County Treasurer, Fixture Wren County, ZZ. Held by Carol Wynn since 2019. Pays $52,900 a year. About 2,100 votes to win. Filing closes in 12 days, on Friday, November 27, 2026.',
  allUnknown:
    'County Treasurer, Fixture Wren County, ZZ. Pay not known yet. Votes to win not known yet. Filing deadline not known yet.',
};

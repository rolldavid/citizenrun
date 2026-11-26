import { z } from 'zod';
import {
  ConfidenceSchema,
  ElectionKindSchema,
  IsoDateSchema,
  LevelSchema,
  TrackSchema,
  TurnoutClassSchema,
} from '../bundle/common.ts';
import type { MeetingTime } from '../bundle/fits-day-job.ts';
import { LIMITS } from '../policy/limits.ts';
import { SOURCE_URL_MAX } from '../policy/links.ts'; // L-links
import { FieldMetaSchema, InstantSchema, MediaSchema } from './common.ts';

// The civic shapes. Response schemas send every key, with null for a value not known and [] for a list
// known to be empty; only the keys inside a `fieldMeta` object are optional.

// ---------------------------------------------------------------------------------------------------
// Vocabularies

const LevelComponent = LevelSchema.meta({ id: 'Level' });
const ElectionKindComponent = ElectionKindSchema.meta({ id: 'ElectionKind' });
const TurnoutClassComponent = TurnoutClassSchema.meta({ id: 'TurnoutClass' });
// The Confidence component is FieldMeta's (common.ts); a second copy with the same id would clash, so
// the confidence keys here use the stored enum as is.

/** `office_types.level` and `districts.level`. */
export type Level = z.infer<typeof LevelSchema>;

/** `jurisdictions.kind`. */
export const JurisdictionKindSchema = z
  .enum([
    'state',
    'county',
    'city',
    'township',
    'school_district',
    'special_district',
    'coop',
    'party',
  ])
  .meta({ id: 'JurisdictionKind' });

export type JurisdictionKind = z.infer<typeof JurisdictionKindSchema>;

/** `office_types.electorate`: who votes for the office. */
export const ElectorateSchema = z.enum(['public', 'members', 'party']).meta({ id: 'Electorate' });

export type Electorate = z.infer<typeof ElectorateSchema>;

/** `offices.pay_kind`. */
export const PayKindSchema = z
  .enum(['salary', 'stipend', 'per_meeting', 'none'])
  .meta({ id: 'PayKind' });

export type PayKind = z.infer<typeof PayKindSchema>;

/** `offices.pay_period`. */
export const PayPeriodSchema = z.enum(['year', 'month', 'meeting']).meta({ id: 'PayPeriod' });

export type PayPeriod = z.infer<typeof PayPeriodSchema>;

/** One value of `offices.benefits`. */
export const BenefitSchema = z.enum(['health', 'retirement', 'other']).meta({ id: 'Benefit' });

export type Benefit = z.infer<typeof BenefitSchema>;

/** One value of `offices.meeting_times`; the type is the one L-fits-day-job reads. */
export const MeetingTimeSchema = z
  .enum(['daytime', 'evenings', 'weekends'] satisfies [MeetingTime, ...MeetingTime[]])
  .meta({ id: 'MeetingTime' });

/** `offices.fits_day_job` (L-fits-day-job). */
export const FitsDayJobSchema = z.enum(['yes', 'likely', 'no']).meta({ id: 'FitsDayJob' });

export type FitsDayJob = z.infer<typeof FitsDayJobSchema>;

/** `filing_tracks.track` (D-081). */
export const TrackKindSchema = TrackSchema.meta({ id: 'TrackKind' });

export type TrackKind = z.infer<typeof TrackSchema>;

/** `elections.deadline_basis` and `filing_tracks.basis`. */
export const DeadlineBasisSchema = z
  .enum(['computed', 'scraped', 'both'])
  .meta({ id: 'DeadlineBasis' });

export type DeadlineBasis = z.infer<typeof DeadlineBasisSchema>;

/** `candidacies.status`. */
export const CandidacyStatusSchema = z
  .enum([
    'committee_registered',
    'filed',
    'qualified',
    'on_ballot',
    'advanced',
    'withdrawn',
    'disqualified',
    'won',
    'lost',
  ])
  .meta({ id: 'CandidacyStatus' });

export type CandidacyStatus = z.infer<typeof CandidacyStatusSchema>;

/** `districts.lean_basis` (D-323). */
export const LeanBasisSchema = z
  .enum(['precinct', 'county', 'precinct_2020_county_swing'])
  .meta({ id: 'LeanBasis' });

export type LeanBasis = z.infer<typeof LeanBasisSchema>;

/** The kind of one `offices.eligibility` requirement. */
export const EligibilityKindSchema = z
  .enum([
    'min_age',
    'residency',
    'registered_voter',
    'party_member',
    'outside_employment_ban',
    'resign_to_run',
    'other',
  ])
  .meta({ id: 'EligibilityKind' });

export type EligibilityKind = z.infer<typeof EligibilityKindSchema>;

/** `offices.party_selection`: how a party committee seat is filled (D-318). */
export const PartySelectionSchema = z
  .enum(['primary_ballot', 'caucus', 'party_meeting'])
  .meta({ id: 'PartySelection' });

export type PartySelection = z.infer<typeof PartySelectionSchema>;

/** The label of an Impact value. */
export const ImpactLabelSchema = z.enum(['high', 'medium', 'low']).meta({ id: 'ImpactLabel' });

export type ImpactLabel = z.infer<typeof ImpactLabelSchema>;

/** L-filing-status. */
export const FilingStatusSchema = z
  .enum(['no_election', 'closed', 'dates_not_known', 'not_open_yet', 'open', 'opens_not_known'])
  .meta({ id: 'FilingStatus' });

export type FilingStatus = z.infer<typeof FilingStatusSchema>;

/** The sorts of the office list (L-office-list step 5). */
export const OfficeSortSchema = z
  .enum(['opportunity', 'impact', 'ease', 'pay', 'deadline'])
  .meta({ id: 'OfficeSort' });

export type OfficeSort = z.infer<typeof OfficeSortSchema>;

// ---------------------------------------------------------------------------------------------------
// Small parts

const Relevance = z.literal([1, 2, 3]);
const nullableText = z.string().nullable();
const nullableDate = IsoDateSchema.nullable();
const nullableInt = z.number().int().nullable();

/** A filing date as stored, with its sourced closing hour and the zone both are local to. */
export const LocalDeadlineSchema = z
  .object({
    date: IsoDateSchema,
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable(),
    timezone: nullableText,
  })
  .meta({ id: 'LocalDeadline' });

export type LocalDeadline = z.infer<typeof LocalDeadlineSchema>;

/** A pointer to a jurisdiction. */
export const JurisdictionRefSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: JurisdictionKindSchema,
    state: z.string(),
    website: nullableText,
    timezone: nullableText,
  })
  .meta({ id: 'JurisdictionRef' });

export type JurisdictionRef = z.infer<typeof JurisdictionRefSchema>;

/** A pointer to a district, with its tile feature id (D-052). */
export const DistrictRefSchema = z
  .object({
    id: z.uuid(),
    tileId: z.number().int(),
    name: z.string(),
    level: LevelComponent,
    geometryQuality: z.enum(['exact', 'parent_fallback', 'county_approx']),
  })
  .meta({ id: 'DistrictRef' });

export type DistrictRef = z.infer<typeof DistrictRefSchema>;

/** A pointer to an office for timelines and search rows. */
export const OfficeRefSchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    title: z.string(),
    state: z.string(),
    jurisdictionName: z.string(),
    retiredAt: InstantSchema.nullable(),
  })
  .meta({ id: 'OfficeRef' });

export type OfficeRef = z.infer<typeof OfficeRefSchema>;

/** A person as a card or a row shows them, with the viewer's follow flag. */
export const PersonSummarySchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    party: nullableText,
    photo: MediaSchema.nullable(),
    photoCredit: nullableText,
    claimed: z.boolean(),
    rosterOnly: z.boolean(),
    retiredAt: InstantSchema.nullable(),
    viewer: z.object({ following: z.boolean() }),
  })
  .meta({ id: 'PersonSummary' });

export type PersonSummary = z.infer<typeof PersonSummarySchema>;

/** One candidacy on the filing timeline (D-325). */
export const CandidacyViewSchema = z
  .object({
    id: z.uuid(),
    person: PersonSummarySchema,
    office: OfficeRefSchema,
    electionId: z.uuid(),
    electionDate: IsoDateSchema,
    electionKind: ElectionKindComponent,
    electionParty: nullableText,
    party: nullableText,
    status: CandidacyStatusSchema,
    statusHistory: z.array(
      z.object({ status: CandidacyStatusSchema, on: IsoDateSchema, sourceUrl: nullableText }),
    ),
    filedOn: nullableDate,
    sourceUrl: nullableText,
  })
  .meta({ id: 'CandidacyView' });

export type CandidacyView = z.infer<typeof CandidacyViewSchema>;

// ---------------------------------------------------------------------------------------------------
// Offices

/** Card-level office data with the viewer's flags (L-office-summary). */
export const OfficeSummarySchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    title: z.string(),
    officeTypeId: z.string(),
    level: LevelComponent,
    electorate: ElectorateSchema,
    state: z.string(),
    jurisdiction: JurisdictionRefSchema,
    district: DistrictRefSchema,
    outline: z
      .object({
        svg: z.string(),
        bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      })
      .nullable(),
    placeholder: z.boolean(),
    completeness: z.enum(['complete', 'partial', 'minimal']).nullable(),
    partisan: z.boolean().nullable(),
    seats: z.number().int(),
    bodySize: nullableInt,
    seatsUpNext: nullableInt,
    payAnnualCents: nullableInt,
    payKind: PayKindSchema.nullable(),
    payAmountCents: nullableInt,
    payPeriod: PayPeriodSchema.nullable(),
    hoursPerWeek: z.number().nullable(),
    fitsDayJob: FitsDayJobSchema.nullable(),
    fullTime: z.boolean().nullable(),
    signaturesRequired: nullableInt,
    filingFeeCents: nullableInt,
    costToRunCents: nullableInt,
    ease: nullableInt,
    easeConfidence: ConfidenceSchema.nullable(),
    impact: nullableInt,
    impactMode: z.enum(['personal', 'single_issue']),
    impactIssueId: nullableText,
    opportunity: nullableInt,
    votesToWin: nullableInt,
    votesLow: nullableInt,
    votesHigh: nullableInt,
    votesEstimated: z.boolean().nullable(),
    nextElection: z
      .object({
        id: z.uuid(),
        electionDate: IsoDateSchema,
        kind: ElectionKindComponent,
        party: nullableText,
      })
      .nullable(),
    filingDeadline: LocalDeadlineSchema.nullable(),
    filingStatus: FilingStatusSchema,
    headlineIssueId: nullableText,
    issues: z.array(z.object({ issueId: z.string(), relevance: Relevance })),
    featuredOfficeholder: PersonSummarySchema.nullable(),
    featuredHolderSince: nullableDate,
    openSeat: z.enum(['vacant', 'term_limited', 'not_running']).nullable(),
    fieldMeta: z.object({
      payAnnualCents: FieldMetaSchema.optional(),
      payAmountCents: FieldMetaSchema.optional(),
      hoursPerWeek: FieldMetaSchema.optional(),
      filingFeeCents: FieldMetaSchema.optional(),
      filingDeadline: FieldMetaSchema.optional(),
    }),
    retiredAt: InstantSchema.nullable(),
    viewer: z.object({
      following: z.boolean(),
      bookmarked: z.boolean(),
      running: z.boolean(),
      declarationId: z.uuid().nullable(),
    }),
  })
  .meta({ id: 'OfficeSummary' });

export type OfficeSummary = z.infer<typeof OfficeSummarySchema>;

/** One filing track of an election, with the proof of each act-on column (02 T-filing_tracks). */
export const FilingTrackSchema = z
  .object({
    id: z.uuid(),
    track: TrackKindSchema,
    opensOn: nullableDate,
    closesOn: nullableDate,
    closesTime: nullableText,
    timezone: nullableText,
    petitionOpens: nullableDate,
    petitionDue: nullableDate,
    feeCents: nullableInt,
    signatures: nullableInt,
    whereToFile: nullableText,
    basis: DeadlineBasisSchema,
    sourceUrl: nullableText,
    quote: nullableText,
    ruleCitation: nullableText,
    confidence: ConfidenceSchema,
    checkedAt: InstantSchema,
    fieldMeta: z.object({
      opensOn: FieldMetaSchema.optional(),
      closesOn: FieldMetaSchema.optional(),
      closesTime: FieldMetaSchema.optional(),
      petitionOpens: FieldMetaSchema.optional(),
      petitionDue: FieldMetaSchema.optional(),
      feeCents: FieldMetaSchema.optional(),
      signatures: FieldMetaSchema.optional(),
      whereToFile: FieldMetaSchema.optional(),
    }),
  })
  .meta({ id: 'FilingTrack' });

export type FilingTrack = z.infer<typeof FilingTrackSchema>;

/** One election of an office, with its tracks. */
export const ElectionViewSchema = z
  .object({
    id: z.uuid(),
    officeId: z.uuid(),
    electionDate: IsoDateSchema,
    electionDateMeta: FieldMetaSchema.nullable(),
    kind: ElectionKindComponent,
    party: nullableText,
    turnoutClass: TurnoutClassComponent,
    filingOpens: nullableDate,
    filingDeadline: LocalDeadlineSchema.nullable(),
    petitionDue: nullableDate,
    deadlineBasis: DeadlineBasisSchema.nullable(),
    deadlineConflict: z
      .array(
        z.object({
          track: TrackKindSchema,
          field: z.string(),
          computed: z.object({ value: nullableText, ruleCitation: nullableText }),
          scraped: z.object({
            value: nullableText,
            sourceUrl: nullableText,
            quote: nullableText,
            checkedAt: InstantSchema.nullable(),
          }),
        }),
      )
      .nullable(),
    filingStatus: FilingStatusSchema,
    tracks: z.array(FilingTrackSchema),
    candidatesCount: z.number().int(),
  })
  .meta({ id: 'ElectionView' });

export type ElectionView = z.infer<typeof ElectionViewSchema>;

/** One past result of an office. */
export const ResultViewSchema = z
  .object({
    id: z.uuid(),
    electionDate: IsoDateSchema,
    kind: ElectionKindComponent,
    party: nullableText,
    turnoutClass: TurnoutClassComponent,
    totalVotes: nullableInt,
    turnoutPct: nullableInt,
    winnerVotes: nullableInt,
    marginVotes: nullableInt,
    contested: z.boolean().nullable(),
    candidates: z
      .array(
        z.object({
          name: z.string(),
          party: nullableText,
          votes: z.number().int(),
          winner: z.boolean(),
        }),
      )
      .nullable(),
    certified: z.boolean(),
    sourceUrl: nullableText,
    checkedAt: InstantSchema.nullable(),
  })
  .meta({ id: 'ResultView' });

export type ResultView = z.infer<typeof ResultViewSchema>;

/** The office page: every summary key and the page's own. */
export const OfficeDetailSchema = OfficeSummarySchema.extend({
  officeTypeName: z.string(),
  termYears: nullableInt,
  termLimitTerms: nullableInt,
  electorateCount: nullableInt,
  benefits: z.array(BenefitSchema).nullable(),
  meetingTimes: z.array(MeetingTimeSchema).nullable(),
  payChangeNote: nullableText,
  termPayCents: nullableInt,
  effectiveHourlyCents: nullableInt,
  whereToFile: nullableText,
  partySelection: PartySelectionSchema.nullable(),
  eligibility: z
    .array(
      z.object({
        kind: EligibilityKindSchema,
        value: z.string(),
        quote: nullableText,
        sourceUrl: nullableText,
        confidence: ConfidenceSchema,
      }),
    )
    .nullable(),
  budget: z.object({
    cents: nullableInt,
    year: nullableInt,
    meta: FieldMetaSchema.nullable(),
  }),
  powers: z.array(
    z.object({
      powerId: z.string(),
      name: z.string(),
      description: z.string(),
      relevance: Relevance,
      quote: nullableText,
      sourceUrl: nullableText,
      confidence: ConfidenceSchema,
      checkedAt: InstantSchema.nullable(),
      issueIds: z.array(z.string()),
    }),
  ),
  issueRelevance: z.array(z.object({ issueId: z.string(), relevance: Relevance })),
  headlineIssue: z
    .object({
      issueId: z.string(),
      a: z.number(),
      relevance: Relevance,
      impact: z.number().int(),
      impactLabel: ImpactLabelSchema,
      powerId: nullableText,
      powerName: nullableText,
    })
    .nullable(),
  impactInputs: z.object({
    issues: z.array(
      z.object({
        issueId: z.string(),
        starred: z.boolean(),
        a: z.number(),
        relevance: z.literal([0, 1, 2, 3]),
      }),
    ),
    scale: z.number().nullable(),
    pivot: z.number().nullable(),
    termFactor: z.number().nullable(),
    population: nullableInt,
    populationSource: nullableText,
    label: ImpactLabelSchema.nullable(),
  }),
  easeInputs: z
    .array(
      z.object({
        key: z.enum([
          'votes_to_win',
          'uncontested',
          'open_seat',
          'margin_pct',
          'incumbent_cash',
          'ballot_cost',
          'deadline_pressure',
          'lean',
        ]),
        value: z.number().nullable(),
        known: z.boolean(),
        sourceUrl: nullableText,
        checkedAt: InstantSchema.nullable(),
        contribution: z.number(),
        note: nullableText,
      }),
    )
    .nullable(),
  entrenched: z.boolean().nullable(),
  decidedIn: z.enum(['primary', 'general']).nullable(),
  lean: z.object({
    points: z.number().nullable(),
    basis: LeanBasisSchema.nullable(),
    approximate: z.boolean(),
  }),
  votesBasis: z.enum(['results', 'estimate']).nullable(),
  effort: z
    .object({
      hours: z.number().int(),
      costCents: z.number().int(),
      assumptions: z.array(
        z.object({ key: z.string(), value: z.number().nullable(), unit: z.string() }),
      ),
    })
    .nullable(),
  nextElectionDetail: ElectionViewSchema.nullable(),
  upcomingElections: z.array(ElectionViewSchema),
  results: z.array(ResultViewSchema),
  officeholders: z.array(
    z.object({
      person: PersonSummarySchema,
      seatLabel: nullableText,
      since: nullableDate,
      seatUpNext: z.boolean().nullable(),
      termLimited: z.boolean().nullable(),
      notRunning: z.boolean().nullable(),
      cashOnHandCents: nullableInt,
      cashAsOf: nullableDate,
      cashSourceUrl: nullableText,
    }),
  ),
  boardControl: z
    .object({
      seats: z.number().int(),
      bodySize: nullableInt,
      seatsUpNext: nullableInt,
      majority: nullableInt,
      partySplit: z
        .array(z.object({ party: nullableText, count: z.number().int().min(0) }))
        .nullable(),
    })
    .nullable(),
  candidates: z.array(CandidacyViewSchema),
  candidatesCount: z.number().int().min(0),
  // No public declaration exists yet, so the list can only be empty.
  declaredRunners: z.array(z.unknown()).max(0),
  declaredRunnersCount: z.number().int().min(0),
  changedAt: InstantSchema,
  fieldMeta: z.object({
    payAnnualCents: FieldMetaSchema.optional(),
    payKind: FieldMetaSchema.optional(),
    payAmountCents: FieldMetaSchema.optional(),
    payPeriod: FieldMetaSchema.optional(),
    benefits: FieldMetaSchema.optional(),
    hoursPerWeek: FieldMetaSchema.optional(),
    fullTime: FieldMetaSchema.optional(),
    meetingTimes: FieldMetaSchema.optional(),
    payChangeNote: FieldMetaSchema.optional(),
    filingFeeCents: FieldMetaSchema.optional(),
    signaturesRequired: FieldMetaSchema.optional(),
    whereToFile: FieldMetaSchema.optional(),
    seats: FieldMetaSchema.optional(),
    bodySize: FieldMetaSchema.optional(),
    seatsUpNext: FieldMetaSchema.optional(),
    termYears: FieldMetaSchema.optional(),
    termLimitTerms: FieldMetaSchema.optional(),
    partisan: FieldMetaSchema.optional(),
    partySelection: FieldMetaSchema.optional(),
    electorateCount: FieldMetaSchema.optional(),
    filingDeadline: FieldMetaSchema.optional(),
  }),
}).meta({ id: 'OfficeDetail' });

export type OfficeDetail = z.infer<typeof OfficeDetailSchema>;

/** A page of the office list, with the size of the matched set on the set path (D-518). */
export const OfficeListPageSchema = z
  .object({
    items: z.array(OfficeSummarySchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().min(0).nullable(),
  })
  .meta({ id: 'OfficeListPage' });

export type OfficeListPage = z.infer<typeof OfficeListPageSchema>;

/** The keys of OfficeDetail that hold user-written or user-identifying content (D-480). */
export const OFFICE_USER_CONTENT_KEYS = ['declaredRunners', 'declaredRunnersCount'] as const;

// ---------------------------------------------------------------------------------------------------
// People

/** The person page: every summary key and the page's own. */
export const PersonDetailSchema = PersonSummarySchema.extend({
  photoLicense: nullableText,
  photoSourceUrl: nullableText,
  photoSource: z.enum(['public_record', 'owner']).nullable(),
  origin: z.enum(['bundle', 'filing', 'admin']).nullable(),
  website: nullableText,
  donateUrl: nullableText,
  volunteerUrl: nullableText,
  pendingLinks: z
    .object({
      website: nullableText,
      donateUrl: nullableText,
      volunteerUrl: nullableText,
      requestedAt: InstantSchema,
    })
    .nullable(),
  seats: z.array(
    z.object({
      office: OfficeRefSchema,
      seatLabel: nullableText,
      since: nullableDate,
      until: nullableDate,
      current: z.boolean(),
    }),
  ),
  candidacies: z.array(CandidacyViewSchema),
  // The owner's UserSummary arrives with claims; until then no profile is claimed in a response.
  claimedBy: z.null(),
  followerCount: z.number().int().min(0),
  tools: z.object({ claims: z.boolean(), links: z.boolean(), help: z.boolean() }),
  help: z.object({ available: z.boolean(), offered: z.boolean() }).nullable(),
  viewer: z.object({
    following: z.boolean(),
    isOwner: z.boolean(),
    claimStatus: z.enum(['pending', 'approved', 'rejected', 'revoked']).nullable(),
    photoPending: z.boolean(),
    pendingClaim: z
      .object({ code: z.string(), senderEmail: z.string(), sendTo: z.string() })
      .nullable(),
  }),
}).meta({ id: 'PersonDetail' });

export type PersonDetail = z.infer<typeof PersonDetailSchema>;

/** The keys of PersonDetail that hold user-identifying content (D-480). */
export const PERSON_USER_CONTENT_KEYS = ['claimedBy'] as const;

// ---------------------------------------------------------------------------------------------------
// Field reports

/** The office and election columns a field report may name (L-field-report-fields). */
export const FIELD_REPORT_FIELDS = [
  'title',
  'seats',
  'body_size',
  'seats_up_next',
  'term_years',
  'term_limit_terms',
  'partisan',
  'pay_annual_cents',
  'pay_kind',
  'pay_amount_cents',
  'pay_period',
  'pay_change_note',
  'benefits',
  'hours_per_week',
  'full_time',
  'meeting_times',
  'filing_fee_cents',
  'signatures_required',
  'where_to_file',
  'eligibility',
  'election_date',
  'filing_opens',
  'filing_deadline',
  'petition_due',
] as const;

export const FieldReportFieldSchema = z.enum(FIELD_REPORT_FIELDS).meta({ id: 'FieldReportField' });

export type FieldReportField = z.infer<typeof FieldReportFieldSchema>;

/**
 * The body of a field report: a note, a link or both. An absent key means null. The link is a bounded
 * string here; the service checks it with parseSafeUrl, so an unsafe link answers link_invalid.
 */
export const FieldReportInputSchema = z
  .object({
    field: FieldReportFieldSchema.nullable().optional(),
    message: z.string().trim().min(1).max(LIMITS.reportNoteChars).nullable().optional(),
    sourceUrl: z.string().trim().max(SOURCE_URL_MAX).nullable().optional(),
  })
  .superRefine((body, ctx) => {
    const hasMessage = body.message !== null && body.message !== undefined;
    const hasLink = body.sourceUrl !== null && body.sourceUrl !== undefined;
    if (!hasMessage && !hasLink) {
      ctx.addIssue({
        code: 'custom',
        path: ['message'],
        params: { code: 'required' },
        message: 'A note or a link is required.',
      });
    }
  })
  .meta({ id: 'FieldReportInput' });

export type FieldReportInput = z.infer<typeof FieldReportInputSchema>;

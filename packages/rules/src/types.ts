// The interface every state rules module implements (PIPE-rules-api, PIPE-rules-fixtures).
import type { ElectionKind } from '@citizenrun/shared';
import type { HolidayCalendar } from './dates.ts';

export type { ElectionKind } from '@citizenrun/shared';

export type IsoDate = string; // 'YYYY-MM-DD', a calendar date with no zone
export type LocalTime = string; // 'HH:MM', local to the jurisdiction's IANA zone (LR-2)
export type TrackKind = 'party_primary' | 'independent' | 'nonpartisan' | 'write_in' | 'incumbent';

/** Every rule output carries the statute it implements (D-330). */
export type Citation = {
  readonly citation: string; // 'RCW 29A.24.050'
  readonly sourceUrl: string; // https
  readonly quote: string; // exact statute or calendar text
  readonly validFrom: IsoDate; // applies to contests on or after this date (D-330)
  readonly validTo: IsoDate | null;
};
export type Computed<T> = { readonly value: T; readonly citation: Citation };

export type OfficeRef = {
  readonly state: string;
  readonly templateKey: string;
  readonly officeTypeId: string;
  readonly jurisdictionKind:
    | 'state'
    | 'county'
    | 'city'
    | 'township'
    | 'school_district'
    | 'special_district'
    | 'coop'
    | 'party';
  readonly countyGeoid: string | null;
  readonly partisan: boolean | null;
  readonly schedule: string;
  readonly trackSet: string;
  readonly staggerGroup: string | null;
  readonly termYears: number | null;
  readonly payAnnualCents: number | null;
  readonly population: number | null;
};

/** What evaluateSignatures reads; no signature rule reads more at launch. */
export type SignatureInputs = { readonly office: OfficeRef };

export type ContestRef = {
  readonly date: IsoDate;
  readonly kind: ElectionKind;
  readonly party: string | null;
};

export type ContestOut = ContestRef & {
  readonly dateCitation: Citation;
  readonly electsOutright: boolean; // a primary that can elect (Louisiana), D-329
};

export type FeeRule =
  | { readonly kind: 'fixed'; readonly cents: number }
  | { readonly kind: 'percent_of_annual_pay'; readonly percent: number }
  | { readonly kind: 'none' };

export type SignatureRule =
  | { readonly kind: 'fixed'; readonly count: number }
  | { readonly kind: 'range'; readonly min: number; readonly max: number } // a statutory range
  | { readonly kind: 'percent_of_registered'; readonly percent: number }
  | {
      readonly kind: 'percent_of_votes';
      readonly percent: number;
      readonly base: 'last_same_office' | 'last_governor';
    }
  | { readonly kind: 'none' };

export type TrackOut = {
  readonly track: TrackKind;
  readonly opensOn: Computed<IsoDate> | null;
  readonly closesOn: Computed<IsoDate>;
  readonly closesTime: Computed<LocalTime> | null; // only when the cited text states the hour (LR-2)
  readonly petitionOpens: Computed<IsoDate> | null;
  readonly petitionDue: Computed<IsoDate> | null;
  readonly fee: Computed<FeeRule> | null;
  readonly signatures: Computed<SignatureRule> | null;
  readonly alternatives: readonly {
    readonly kind: 'petition_in_lieu_of_fee';
    readonly signatures: Computed<SignatureRule>;
  }[];
  readonly whereToFile: Computed<string> | null;
  readonly withdrawalDeadline: Computed<IsoDate> | null;
};

export interface StateRules {
  readonly state: string;
  readonly schedules: readonly string[]; // ids the template may name in `schedule`
  readonly trackSets: readonly string[]; // ids the template may name in `track_set`
  holidays(year: number): HolidayCalendar;
  /** The contests an office has in a year: election dates, kinds and parties (template election timing). */
  contests(input: { readonly office: OfficeRef; readonly year: number }): readonly ContestOut[];
  /** Filing tracks of one contest. Empty when the office files no papers for it. */
  filingTracks(input: {
    readonly office: OfficeRef;
    readonly contest: ContestRef;
  }): readonly TrackOut[];
  /** The date after which results of the contest are final (D-322). */
  certificationDate(input: {
    readonly office: OfficeRef;
    readonly contest: ContestRef;
  }): Computed<IsoDate> | null;
  /** Statutory county officer pay where the template says county_pay is statute or mixed (D-317). */
  countyPay(input: {
    readonly office: OfficeRef;
    readonly year: number;
  }): Computed<{ amountCents: number; period: 'year' | 'month' }> | null;
}

export type RulesFixture = {
  readonly state: string;
  readonly source: {
    readonly title: string;
    readonly url: string;
    readonly retrievedOn: IsoDate;
    readonly sha256: string;
  };
  readonly contests: readonly {
    readonly id: string;
    readonly office: Partial<OfficeRef> &
      Pick<OfficeRef, 'templateKey' | 'officeTypeId' | 'schedule' | 'trackSet'>;
    readonly year: number;
    readonly expect: readonly ContestRef[]; // exact list, in date order
    readonly quote: string; // the text in the official document that states the dates
  }[];
  readonly cases: readonly {
    readonly id: string;
    readonly office: Partial<OfficeRef> &
      Pick<OfficeRef, 'templateKey' | 'officeTypeId' | 'schedule' | 'trackSet'>;
    readonly contest: ContestRef;
    readonly expect: readonly FixtureTrackExpect[];
    readonly quote: string;
  }[];
};

/** Only the keys present are compared; a key present with null must be null. */
export type FixtureTrackExpect = {
  readonly track: TrackKind;
  readonly opensOn?: IsoDate | null;
  readonly closesOn?: IsoDate | null;
  readonly closesTime?: LocalTime | null;
  readonly petitionOpens?: IsoDate | null;
  readonly petitionDue?: IsoDate | null;
  readonly withdrawalDeadline?: IsoDate | null;
};

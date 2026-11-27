import { assertNever, formatDate, isIssueId } from '@citizenrun/shared';
import type { OfficeSummary, TFunction } from '@citizenrun/shared';
import { hasOfficeType } from '../art/office-art.tsx';
import type { CardContext } from '../feed.ts';
import { canDraw, foldForCanvas } from '../text/fold.ts';
import { camelKey } from './keys.ts';
import type { KickerModel, OfficeTopModel } from './region-models.ts';
import type { RunAgainstData } from './run-against.ts';

// The words of an office canvas's top zone (CARD-region-office-top, CARD-text-fold): each string is
// translated, formatted and folded for the face it is set in.

/** The lead issue of an office: its headline issue, else its first issue; null for none, or for an issue this build does not know. */
export function leadIssueId(office: OfficeSummary): string | null {
  const id = office.headlineIssueId ?? office.issues[0]?.issueId ?? null;
  return id !== null && isIssueId(id) ? id : null;
}

/** The level of an office as a label: "County office". */
export function levelLabel(level: OfficeSummary['level'], t: TFunction): string {
  switch (level) {
    case 'local':
      return t('cards:kicker.levelLocal');
    case 'county':
      return t('cards:kicker.levelCounty');
    case 'state':
      return t('cards:kicker.levelState');
    case 'federal':
      return t('cards:kicker.levelFederal');
    case 'special':
      return t('cards:kicker.levelSpecial');
    default:
      return assertNever(level);
  }
}

/** The kicker of an office canvas: the lead issue's short name behind its tile, or the level label alone. */
export function kickerModel(office: OfficeSummary, t: TFunction): KickerModel {
  const issueId = leadIssueId(office);
  if (issueId === null) {
    return { issueId: null, label: levelLabel(office.level, t) };
  }
  return { issueId, label: t(`common:issueShort.${camelKey(issueId)}`) };
}

/**
 * The title a canvas draws: the office's own title when the face has every character of it, else
 * the office type's short name, else the level label for an office type this build does not know.
 * A title is never folded.
 */
export function officeTitleText(office: OfficeSummary, t: TFunction): string {
  if (canDraw(office.title, 'medium')) {
    return office.title;
  }
  if (hasOfficeType(office.officeTypeId)) {
    return t(`cards:officeType.${camelKey(office.officeTypeId)}`);
  }
  return levelLabel(office.level, t);
}

/** The place around `name`: the name alone for a state, else the name with the state's code; '' for no name. */
function placeOf(name: string, office: OfficeSummary, t: TFunction): string {
  if (name === '') {
    return '';
  }
  if (office.jurisdiction.kind === 'state') {
    return name;
  }
  return t('cards:place.inState', { place: name, state: office.jurisdiction.state });
}

/** The place line of a canvas, with the jurisdiction's name folded for the face; '' when nothing of it can be drawn. */
export function placeText(office: OfficeSummary, t: TFunction): string {
  return placeOf(foldForCanvas(office.jurisdiction.name, 'medium'), office, t);
}

/** The place as the alt text says it, with the jurisdiction's name as written. */
export function placeAltText(office: OfficeSummary, t: TFunction): string {
  return placeOf(office.jurisdiction.name.trim(), office, t);
}

/** The election line: the next election by its kind with its date, or why there is none. */
export function electionLineText(office: OfficeSummary, t: TFunction, ctx: CardContext): string {
  const election = office.nextElection;
  if (election === null) {
    return office.filingStatus === 'no_election'
      ? t('cards:election.none')
      : t('cards:election.filingClosed');
  }
  const date = formatDate(election.electionDate, ctx.locale, 'medium');
  switch (election.kind) {
    case 'general':
      return t('cards:election.general', { date });
    case 'primary':
      return t('cards:election.primary', { date });
    case 'primary_runoff':
      return t('cards:election.primaryRunoff', { date });
    case 'general_runoff':
      return t('cards:election.generalRunoff', { date });
    case 'special':
      return t('cards:election.special', { date });
    default:
      return assertNever(election.kind);
  }
}

function openSeatLine(openSeat: NonNullable<OfficeSummary['openSeat']>, t: TFunction): string {
  switch (openSeat) {
    case 'not_running':
      return t('cards:holder.notRunning');
    case 'term_limited':
      return t('cards:holder.termLimited');
    case 'vacant':
      return t('cards:holder.vacant');
    default:
      return assertNever(openSeat);
  }
}

/**
 * The holder block: an open seat and why it is open, else the holder's folded name and how long
 * they have held the office; null when there is no holder, or nothing of the name can be drawn.
 * The same two lines for every person: never initials, never a disc.
 */
export function holderModel(
  data: Pick<RunAgainstData, 'office' | 'featuredPerson'>,
  t: TFunction,
): OfficeTopModel['holder'] {
  const { office, featuredPerson } = data;
  if (office.openSeat !== null) {
    return { line1: t('cards:holder.openSeat'), line2: openSeatLine(office.openSeat, t) };
  }
  if (featuredPerson === null) {
    return null;
  }
  const name = foldForCanvas(featuredPerson.name, 'medium');
  if (name === '') {
    return null;
  }
  return {
    line1: name,
    line2:
      office.featuredHolderSince === null
        ? t('cards:holder.current')
        : t('cards:holder.since', { year: office.featuredHolderSince.slice(0, 4) }),
  };
}

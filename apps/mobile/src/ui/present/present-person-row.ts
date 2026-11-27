import { formatDate, partyLabel } from '@citizenrun/shared';
import type { CandidacyView, TFunction } from '@citizenrun/shared';
import type { CardContext } from '@citizenrun/cards';

import type { PersonEntry } from '@/lib/view-models/common.types';
import type { PersonRowProps } from '@/ui/components/person-row';

export type PersonRowInput =
  | {
      kind: 'holder';
      entry: PersonEntry;
      /** Whether the office is partisan; null when that is not known. */
      partisan: boolean | null;
      /** The day the holder took the seat, as a calendar date. */
      since: string | null;
      seatLabel: string | null;
      testID: string;
    }
  | { kind: 'candidate'; entry: PersonEntry; candidacy: CandidacyView; testID: string };

type RowTag = PersonRowProps['tag'];

/** A candidacy's status as a tag: solid while the person is in the race or has won it (PC6A-14). */
function statusTag(candidacy: CandidacyView, t: TFunction): NonNullable<RowTag> {
  switch (candidacy.status) {
    case 'committee_registered':
      return { label: t('common:candidacy.committeeRegistered'), variant: 'outline' };
    case 'filed':
      return { label: t('common:candidacy.filed'), variant: 'solid' };
    case 'qualified':
      return { label: t('common:candidacy.qualified'), variant: 'solid' };
    case 'on_ballot':
      return { label: t('common:candidacy.onBallot'), variant: 'solid' };
    case 'advanced':
      return { label: t('common:candidacy.advanced'), variant: 'solid' };
    case 'withdrawn':
      return { label: t('common:candidacy.withdrawn'), variant: 'outline' };
    case 'disqualified':
      return { label: t('common:candidacy.disqualified'), variant: 'outline' };
    case 'won':
      return { label: t('common:candidacy.won'), variant: 'solid' };
    case 'lost':
      return { label: t('common:candidacy.lost'), variant: 'outline' };
    default: {
      // A status this build does not know is stored data, shown as it is sent.
      const sent: string = candidacy.status;
      return { label: sent.replaceAll('_', ' '), variant: 'outline' };
    }
  }
}

function candidateLine(candidacy: CandidacyView, t: TFunction, ctx: CardContext): string {
  // A registered committee is not a filing, and is never worded as one.
  if (candidacy.status === 'committee_registered') {
    return t('office:candidate.committee');
  }
  return candidacy.filedOn === null
    ? t('office:candidate.fromFilings')
    : t('office:candidate.filedOn', { date: formatDate(candidacy.filedOn, ctx.locale, 'short') });
}

/**
 * C-PersonRow's props for a holder or a candidate of an office. A holder's tag is the party word,
 * only where the office is partisan and the party is known; a candidate's is the filing status.
 * No photo draws the initials.
 */
export function presentPersonRow(
  input: PersonRowInput,
  t: TFunction,
  ctx: CardContext,
): PersonRowProps {
  const { person } = input.entry;
  const shared = {
    image: person.photo === null ? null : { key: person.photo.key, url: person.photo.url },
    name: person.name,
    handle: null,
    action: null,
    href: input.entry.href,
    testID: input.testID,
  };
  if (input.kind === 'candidate') {
    return {
      ...shared,
      line: candidateLine(input.candidacy, t, ctx),
      tag: statusTag(input.candidacy, t),
    };
  }
  let line: string;
  if (input.since !== null) {
    // The year of a calendar date; no date is built.
    line = t('office:holder.since', { year: input.since.slice(0, 4) });
  } else {
    line = input.seatLabel ?? t('office:holder.current');
  }
  return {
    ...shared,
    line,
    tag:
      input.partisan === true && person.party !== null
        ? { label: partyLabel(person.party, t), variant: 'outline' }
        : null,
  };
}

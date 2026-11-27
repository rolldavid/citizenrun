import { isIssueId } from '@citizenrun/shared';
import type { OfficeSummary, TFunction } from '@citizenrun/shared';
import { camelKey } from './keys.ts';
import { levelLabel } from './office-text.ts';

// CARD-shell: the lines of a card's header that no canvas draws.

/** The most issues a match line names. */
const MATCHES_MAX = 2;

/**
 * The second line of an office card's header: the viewer's issues the office decides, in the
 * office's own order, two at most; the level label when none match or nobody is signed in
 * (`viewerIssueIds` null). An office whose district is not exact says so instead.
 */
export function issueMatchLine(
  office: OfficeSummary,
  viewerIssueIds: readonly string[] | null,
  t: TFunction,
): string {
  if (office.district.geometryQuality !== 'exact') {
    return t('cards:header.mayIncludeYou');
  }
  const mine = new Set(viewerIssueIds ?? []);
  // An issue this build does not know has no short name, so it is no match.
  const [first, second] = office.issues
    .map((entry) => entry.issueId)
    .filter((id) => mine.has(id) && isIssueId(id))
    .slice(0, MATCHES_MAX)
    .map((id) => t(`common:issueShort.${camelKey(id)}`));
  if (first === undefined) {
    return levelLabel(office.level, t);
  }
  if (second === undefined) {
    return t('cards:header.matchesOne', { issue: first });
  }
  return t('cards:header.matchesTwo', { first, second });
}

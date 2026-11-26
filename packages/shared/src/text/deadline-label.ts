import { assertNever } from '../errors.ts';
import { formatLocalTime } from '../i18n/format/local-time.ts';
import type { TFunction } from '../i18n/format/t-function.ts';
import type { FilingWindowState } from '../time/filing-window.ts';

/** The deadline line for cards, the office page and the run plan; the not-known sentence for an `unknown` window. */
export function deadlineLabel(state: FilingWindowState, zone: string | null, t: TFunction): string {
  switch (state.state) {
    case 'unknown':
      return t('cards:deadline.unknown');
    case 'not_open':
      return t('cards:deadline.opensIn', { count: state.opensInDays });
    case 'open':
      if (state.daysLeft < 0) {
        throw new RangeError('An open window has no negative days left.');
      }
      if (state.daysLeft === 0) {
        return state.closesTime === null
          ? t('cards:deadline.closesToday')
          : t('cards:deadline.closesTodayAt', {
              time: formatLocalTime(state.closesTime, zone, t),
            });
      }
      return t('cards:deadline.closesIn', { count: state.daysLeft });
    case 'closed':
      return t('cards:deadline.closed');
    default:
      return assertNever(state);
  }
}

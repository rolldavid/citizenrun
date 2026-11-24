import type { PermissionState } from '../shared';
export type { PermissionState } from '../shared';

/** The four all-day events of a declaration (L-ics kinds). */
export type CalendarEventKind = 'opens' | 'deadline' | 'petition' | 'election';

export type CalendarEventInput = {
  declarationId: string;
  kind: CalendarEventKind;
  date: string; // 'YYYY-MM-DD', the local calendar date as the API sends it
  title: string; // translated by the caller: the text of calendar:events.<kind> (L-ics)
  notes: string; // translated by the caller: the closing time line (deadline only), the source link, common:confirmBeforeFiling
  url: string | null; // the date's source URL, else the office page (L-ics "URL")
};

export type CalendarAddOutcome =
  | { kind: 'done'; added: number; updated: number; unchanged: number }
  | { kind: 'denied'; state: PermissionState }
  | { kind: 'unsupported' }
  | { kind: 'failed'; code: CalendarErrorCode };

export type CalendarErrorCode =
  'calendar.create_failed' | 'calendar.write_failed' | 'calendar.no_calendar';

export interface CalendarModule {
  /** True on phones (one tap); false on the web. */
  readonly oneTapSupported: boolean;
  /** True on Android, where the app updates and removes its own events (D-172); false on iOS (write-only access) and the web. */
  readonly updatesSupported: boolean;
  getPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  /** Adds the events. Android: updates an event it added before for the same declaration and kind. Never prompts. */
  addEvents(
    events: readonly CalendarEventInput[],
    ownCalendarName: string,
  ): Promise<CalendarAddOutcome>;
  /** Android: deletes the events it added for this declaration (a withdrawal). iOS and web: nothing. */
  removeDeclarationEvents(declarationId: string): Promise<void>;
  /** Web: downloads GET /v1/declarations/:id/calendar.ics (E-CAL-01) through the browser. Phones: 'unsupported'. */
  downloadDeclarationFile(declarationId: string): 'started' | 'unsupported';
  /** The subscribe link to offer for the feed URLs the feed endpoint returned (E-CAL-04, D-172). */
  subscribeLink(feed: { url: string; webcalUrl: string }): string;
  /** Hands a subscribe link to the system: a webcal: link opens the calendar app's subscription; an https: link is
   *  copied (web) or offered through the share sheet (Android), because those calendars add a feed by URL. */
  openSubscribeLink(link: string): Promise<'opened' | 'copied' | 'shared' | 'failed'>;
}

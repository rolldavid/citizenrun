/**
 * Every id and id base of the office page (SCR-office-slug). A derived id joins its base to its
 * part with a hyphen and is written nowhere else.
 */
export const OFFICE_TEST_IDS = {
  screen: 'office.screen',
  loading: 'office.loading',
  hero: 'office.hero',
  /** Base: one id per kind of notice. */
  notice: 'office.notice',
  noticeClerk: 'office.notice-clerk',
  dealLine: 'office.deal-line',
  /** Base: one id per issue. */
  issue: 'office.issue',
  miniMap: 'office.mini-map',
  /** Base: one id per field, by its camelCase name. */
  field: 'office.field',
  /** Base: one id per source row of a section, and the deadline's. */
  sourceLink: 'office.source-link',
  /** Base: one id per source row of the sources section. */
  sourcesOpen: 'office.sources-open',
  sourcesSheet: 'office.sources-sheet',
  /** Base: one id per power. */
  power: 'office.power',
  /** Base: one id per person who holds the office. */
  holder: 'office.holder',
  /** Base: one id per candidacy. */
  candidate: 'office.candidate',
  runningShowAll: 'office.running-show-all',
  stepsOpen: 'office.steps-open',
  stepsSheet: 'office.steps-sheet',
  reportOpen: 'office.report-open',
  reportSheet: 'office.report-sheet',
  reportField: 'office.report-field',
  reportMessage: 'office.report-message',
  reportLink: 'office.report-link',
  reportSend: 'office.report-send',
  reportClose: 'office.report-close',
  actions: 'office.actions',
  runButton: 'office.run-button',
  followButton: 'office.follow-button',
  bookmarkButton: 'office.bookmark-button',
  actionCard: 'office.action-card',
  actionCardEase: 'office.action-card-ease',
  actionCardImpact: 'office.action-card-impact',
  notFoundAction: 'office.not-found-action',
  /** Around text that follows the clock. */
  deadlineLive: 'office.deadline-live',
  /** Around text that follows the clock. */
  actionCardDaysLive: 'office.action-card-days-live',
} as const;

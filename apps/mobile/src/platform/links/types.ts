import type { Unsubscribe } from '../shared';
export type { Unsubscribe } from '../shared';

export type OpenOutcome = 'opened' | 'refused' | 'failed';
export type ReloadReason = 'chunk_error' | 'upgrade_required';

/** A key press on the web page, the shape of the shortcut registry's KeyEventLike, so the root layout passes
 *  links.subscribeKeyDown to ShortcutProvider as it is. */
export type PageKeyEvent = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** The event's target is a text input, a text area, a select or an editable element. */
  inTextField: boolean;
  preventDefault: () => void;
};

/** A face to wait for, as the design system's font list names it (family plus weight). */
export type PageFontFace = { family: string; weight: number };

export type LinksErrorCode = 'links.open_failed';

export interface Links {
  // PM-links
  /** Opens an https URL outside the app: the system browser on phones, a new tab on the web.
   *  'refused' when parseSafeUrl(url, SOURCE_URL_MAX) (L-links) returns null, and nothing is opened. */
  openExternal(url: string): Promise<OpenOutcome>;
  /** Opens a URL the API issued in the response being handled (the data export's presigned
   *  download, E-ME-06). Not for a stored or user-entered link: those go through openExternal.
   *  'refused' unless the URL parses and is https, or is http on the host 'localhost' or '127.0.0.1'. */
  openIssuedUrl(url: string): Promise<OpenOutcome>;
  /** Opens the mail app on an address (support contact, suspension appeal, deletion fallback). */
  openMail(address: string): Promise<OpenOutcome>;
  /** Phones: the system settings page of this app (for a 'blocked' permission). Web: false, nothing opens. */
  openAppSettings(): Promise<boolean>;
  /** True on a phone whose store URL is configured; false on the web. */
  readonly storeListingSupported: boolean;
  /** Phones: opens this app's store page (the blocking update screen of 426). Web: false. */
  openStoreListing(): Promise<boolean>;
  /** Web: reloads the page once per visit for this reason (D-163) and returns true; returns false when
   *  this visit already reloaded for it. Phones: returns false and does nothing. */
  reloadOnce(reason: ReloadReason): boolean;
  /** Web: adds one `keydown` listener on `document`; the returned function removes it. Phones: never calls the
   *  listener and returns a function that does nothing. */
  subscribeKeyDown(listener: (event: PageKeyEvent) => void): Unsubscribe;
  /** Web: true once every face has loaded; false when a face fails to load or matches no `@font-face` rule.
   *  Phones: true at once (the faces are in the binary). */
  fontsReady(faces: readonly PageFontFace[]): Promise<boolean>;
}

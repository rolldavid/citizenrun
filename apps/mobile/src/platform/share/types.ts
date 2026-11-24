export type ShareRequest =
  /** An office card: its share image (CARD-share-image) plus its page link. */
  | { kind: 'office'; officeId: string; url: string; title: string; locale: string }
  /** A post, a profile, a person: the page link only. */
  | { kind: 'link'; url: string; title: string };

/** What prepare() made; held by the module until release(). Opaque to callers. */
export type PreparedShare = {
  readonly id: string;
  readonly request: ShareRequest;
  /** True when the image is ready to share as a file (an office request whose image downloaded). */
  readonly hasImage: boolean;
};

export type ShareOutcome =
  'shared' | 'copied' | 'downloaded' | 'cancelled' | 'unsupported' | 'failed';

export interface ShareModule {
  // PM-share
  /** Phones: always true. Web: whether navigator.share and navigator.canShare exist; a file share also needs
   *  canShare({ files }) for the prepared image, which shareImage checks. */
  readonly nativeSheetSupported: boolean;
  /** Web: navigator.clipboard.writeText exists. Phones: false (the system sheet has Copy). */
  readonly copySupported: boolean;
  /** Call when the share menu opens (before the user's tap). A link request fetches nothing. With PM-share-image
   *  an office request downloads (phones) or fetches (web) the office image; before it, an office request prepares
   *  as a link, with hasImage false. */
  prepare(request: ShareRequest): Promise<PreparedShare>;
  /** The link alone. */
  shareLink(prepared: PreparedShare): Promise<ShareOutcome>;
  /** Web: copies the link. Phones: 'unsupported'. */
  copyLink(prepared: PreparedShare): Promise<ShareOutcome>;
  /** Deletes the cache file or forgets the blob. Safe to call twice. */
  release(prepared: PreparedShare): void;
}

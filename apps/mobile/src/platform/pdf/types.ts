/** The runner details a form's fields take (`field_map.fields[].source`, FormView.fieldMap). */
export type FormSource = 'name' | 'address' | 'office' | 'district' | 'election_date' | 'party';

/** What the runner typed or the app filled in, per source. Null leaves those fields blank. Never sent anywhere. */
export type FormFillValues = Readonly<Record<FormSource, string | null>>;

/** A filled document held by the module until discarded. Opaque to callers. */
export type PdfDocumentHandle = {
  readonly id: string;
  readonly fileName: string;
  readonly byteLength: number;
};

export type PdfFillOutcome =
  | { kind: 'filled'; document: PdfDocumentHandle }
  | { kind: 'value_too_long'; source: FormSource; maxLength: number } // D-334: blocks with a message and writes nothing
  | { kind: 'download_failed' } // the blank could not be fetched
  | { kind: 'changed' } // the blank's SHA-256 differs from FormView.sha256
  | { kind: 'failed'; code: PdfErrorCode };

export type PdfOutputAction = 'preview' | 'share' | 'print' | 'download';
export type PdfOutputOutcome = 'done' | 'cancelled' | 'unsupported' | 'failed';

export type PdfErrorCode = 'pdf.fill_failed' | 'pdf.write_failed' | 'pdf.remember_failed';

export interface PdfModule {
  /** True on phones; false on the web, which never stores form details (D-174). */
  readonly rememberSupported: boolean;
  /** Which output actions this platform offers. */
  readonly outputs: Readonly<Record<PdfOutputAction, boolean>>;
  /** Web: call it synchronously inside the press handler (the browser allows a new tab only during the gesture). */
  output(document: PdfDocumentHandle, action: PdfOutputAction): Promise<PdfOutputOutcome>;
  /** Forgets the document: deletes its cache file or revokes its blob URL. Safe to call twice. */
  discard(document: PdfDocumentHandle): void;
  /** Phones: stores the details (D-174). Web: does nothing. Rejects with 'pdf.remember_failed'. */
  remember(values: FormFillValues): Promise<void>;
  /** Phones: the remembered details or null. Web: null. */
  loadRemembered(): Promise<FormFillValues | null>;
  /** Removes the remembered details. Called by session.endLocal() and by the "forget" control. Never rejects. */
  forgetRemembered(): Promise<void>;
}

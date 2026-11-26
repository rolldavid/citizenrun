// PIPE-text-extract step 2: a PDF's text layer, page by page.
import { extractText, getDocumentProxy } from 'unpdf';

/** Average characters a page needs for the PDF to count as having a text layer (P8-41). */
const TEXT_LAYER_CHARS_PER_PAGE = 100;

export type PdfText = {
  readonly text: string;
  readonly pages: number;
  readonly hasTextLayer: boolean;
};

/** A body that the PDF reader cannot open. */
export class PdfUnreadable extends Error {
  override readonly name = 'PdfUnreadable';

  constructor() {
    super('the PDF cannot be read');
  }
}

/** True when the text averages at least 100 characters a page; false for a PDF of no pages. */
export function hasTextLayer(text: string, pages: number): boolean {
  return pages > 0 && text.length / pages >= TEXT_LAYER_CHARS_PER_PAGE;
}

/** The text of each page joined with a form feed, the page count and whether it has a text layer. */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  let result: { totalPages: number; text: string[] };
  try {
    // The reader may take over the buffer it is given, so it gets a copy; verbosity 0 keeps the
    // reader's own warnings off the console.
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    result = await extractText(pdf, { mergePages: false });
  } catch {
    throw new PdfUnreadable();
  }
  const text = result.text.join('\f');
  return { text, pages: result.totalPages, hasTextLayer: hasTextLayer(text, result.totalPages) };
}

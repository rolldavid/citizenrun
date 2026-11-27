import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PdfUnreadable, extractPdfText, hasTextLayer } from './text-pdf.ts';

// A hand-written one-page statute section PDF in the ZZ fixture world (D-876).
const FIXTURES = join(import.meta.dirname, '..', '__fixtures__', 's03');

describe('extractPdfText', () => {
  it('reads the text layer of the fixture statute PDF', async () => {
    const bytes = new Uint8Array(await readFile(join(FIXTURES, 'zz-statute-section.pdf')));
    const pdf = await extractPdfText(bytes);
    expect(pdf.pages).toBe(1);
    expect(pdf.text).toContain('ZZ Fixture Code 24.050');
    expect(pdf.hasTextLayer).toBe(true);
    expect(pdf.text.replace(/\s+/g, ' ')).toContain(
      'beginning the first Monday in May and ending the following Friday',
    );
    expect(pdf.text.split('\f')).toHaveLength(pdf.pages);
  });

  it('throws PdfUnreadable on bytes that are not a PDF', async () => {
    await expect(extractPdfText(new Uint8Array(randomBytes(256)))).rejects.toBeInstanceOf(
      PdfUnreadable,
    );
  });
});

describe('hasTextLayer', () => {
  it('needs an average of 100 characters a page', () => {
    expect(hasTextLayer('x'.repeat(199), 2)).toBe(false);
    expect(hasTextLayer('x'.repeat(200), 2)).toBe(true);
    expect(hasTextLayer('', 0)).toBe(false);
  });
});

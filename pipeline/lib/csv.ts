import type { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import type { CsvError, Info } from 'csv-parse';

/** A line the parser cannot read. The message names the line number and never the line's text. */
export class CsvFormatError extends Error {
  override readonly name = 'CsvFormatError';

  readonly line: number;

  constructor(line: number) {
    super(`malformed delimited file at line ${String(line)}`);
    this.line = line;
  }
}

function errorLine(error: unknown, fallback: number): number {
  const lines = (error as Partial<CsvError> | null)?.['lines'];
  return typeof lines === 'number' && lines > 0 ? lines : fallback;
}

/**
 * Streams the records of a delimited file. Every record must have as many fields as the first.
 * With `header: true` the first record is the header: it is yielded first, as line 1, and a file
 * without one is malformed at line 1. `line` is the line on which a record ends.
 */
export async function* readDelimited(
  body: Readable,
  opts: { delimiter: ',' | '|' | ';'; header: boolean; encoding: 'utf8' | 'latin1' },
): AsyncIterable<{ line: number; record: readonly string[] }> {
  const parser = parse({
    delimiter: opts.delimiter,
    encoding: opts.encoding,
    bom: true,
    relax_column_count: false,
    record_delimiter: ['\n', '\r\n'],
    info: true,
  });
  body.on('error', (error) => parser.destroy(error));
  body.pipe(parser);
  let seen = 0;
  try {
    for await (const item of parser as AsyncIterable<{ info: Info; record: string[] }>) {
      seen += 1;
      yield { line: item.info.lines, record: item.record };
    }
  } catch (error) {
    if (error instanceof CsvFormatError) throw error;
    const code = (error as Partial<CsvError> | null)?.code;
    if (typeof code === 'string' && code.startsWith('CSV_')) {
      throw new CsvFormatError(errorLine(error, parser.info.lines));
    }
    throw error;
  } finally {
    body.unpipe(parser);
    parser.destroy();
  }
  if (opts.header && seen === 0) {
    throw new CsvFormatError(1);
  }
}

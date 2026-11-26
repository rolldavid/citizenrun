import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CsvFormatError, readDelimited } from './csv.ts';

type Opts = Parameters<typeof readDelimited>[1];

async function readAll(
  bytes: Buffer,
  opts: Opts,
): Promise<{ line: number; record: readonly string[] }[]> {
  const out: { line: number; record: readonly string[] }[] = [];
  for await (const item of readDelimited(Readable.from([bytes]), opts)) {
    out.push(item);
  }
  return out;
}

const PIPE: Opts = { delimiter: '|', header: true, encoding: 'utf8' };

describe('readDelimited', () => {
  it('reads a pipe-delimited file with a header', async () => {
    const text =
      'GEO_ID|NAME|B01001_E001\n0400000US99|Fixture State|1200\n0500000US99001|Fixture County|300\n';
    expect(await readAll(Buffer.from(text), PIPE)).toEqual([
      { line: 1, record: ['GEO_ID', 'NAME', 'B01001_E001'] },
      { line: 2, record: ['0400000US99', 'Fixture State', '1200'] },
      { line: 3, record: ['0500000US99001', 'Fixture County', '300'] },
    ]);
  });

  it('keeps a quoted field that holds the delimiter, and strips a byte-order mark', async () => {
    const text = '﻿code,name\r\n01,"Fixture, Town"\n02,"Say ""hi"""\r\n';
    expect(
      await readAll(Buffer.from(text), { delimiter: ',', header: true, encoding: 'utf8' }),
    ).toEqual([
      { line: 1, record: ['code', 'name'] },
      { line: 2, record: ['01', 'Fixture, Town'] },
      { line: 3, record: ['02', 'Say "hi"'] },
    ]);
  });

  it('reads a semicolon file without a header', async () => {
    const text = 'a;b\nc;d';
    expect(
      await readAll(Buffer.from(text), { delimiter: ';', header: false, encoding: 'utf8' }),
    ).toEqual([
      { line: 1, record: ['a', 'b'] },
      { line: 2, record: ['c', 'd'] },
    ]);
  });

  it('a short line throws with its line number and without its content', async () => {
    const text = 'A|B|C\n1|2|3\nsecret-value|4\n5|6|7\n';
    const error = await readAll(Buffer.from(text), PIPE).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CsvFormatError);
    expect((error as CsvFormatError).line).toBe(3);
    expect((error as CsvFormatError).message).toBe('malformed delimited file at line 3');
    expect((error as Error).message).not.toContain('secret-value');
    expect((error as Error).cause).toBeUndefined();
  });

  it('an unclosed quote throws without its content', async () => {
    const text = 'A|B\n1|"open-secret\n';
    const error = await readAll(Buffer.from(text), PIPE).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CsvFormatError);
    expect((error as Error).message).not.toContain('open-secret');
  });

  it('a file with a header and no lines is malformed at line 1', async () => {
    await expect(readAll(Buffer.from(''), PIPE)).rejects.toThrow(CsvFormatError);
    expect(
      await readAll(Buffer.from(''), { delimiter: '|', header: false, encoding: 'utf8' }),
    ).toEqual([]);
  });

  it('latin1 decodes é written as the byte 0xe9', async () => {
    const bytes = Buffer.concat([
      Buffer.from('name|n\nFixture Caf'),
      Buffer.from([0xe9]),
      Buffer.from('|1\n'),
    ]);
    expect(await readAll(bytes, { delimiter: '|', header: true, encoding: 'latin1' })).toEqual([
      { line: 1, record: ['name', 'n'] },
      { line: 2, record: ['Fixture Café', '1'] },
    ]);
  });
});

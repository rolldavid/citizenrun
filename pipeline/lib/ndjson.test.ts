import { Readable } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  NdjsonGzWriter,
  NdjsonLineError,
  encodeNdjsonGz,
  ndjsonLine,
  orderKeys,
  readNdjsonGz,
} from './ndjson.ts';

const RowSchema = z.strictObject({ id: z.int(), name: z.string() });
type Row = z.infer<typeof RowSchema>;

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({ id: index, name: `row ${String(index)}` }));
}

async function writeAll(input: readonly Row[]) {
  const writer = new NdjsonGzWriter();
  const chunks: Buffer[] = [];
  const consumed = (async () => {
    for await (const chunk of writer.readable as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
  })();
  for (const row of input) {
    writer.write(row);
    if (writer.needsDrain) {
      await writer.drained();
    }
  }
  const result = await writer.end();
  await consumed;
  return { result, bytes: Buffer.concat(chunks) };
}

async function readAll(bytes: Uint8Array): Promise<Row[]> {
  const out: Row[] = [];
  for await (const row of readNdjsonGz(Readable.from([Buffer.from(bytes)]), RowSchema)) {
    out.push(row);
  }
  return out;
}

describe('ndjson', () => {
  it('same rows give the same bytes', async () => {
    const first = await writeAll(rows(1000));
    const second = await writeAll(rows(1000));
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.result.sha256).toBe(second.result.sha256);
    expect(Buffer.from(encodeNdjsonGz(rows(1000))).equals(first.bytes)).toBe(true);
  });

  it('header is normalised', async () => {
    const { bytes, result } = await writeAll(rows(3));
    expect([...bytes.subarray(0, 4)]).toEqual([0x1f, 0x8b, 0x08, 0x00]);
    expect([...bytes.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    expect(bytes[3]).toBe(0);
    expect(bytes[9]).toBe(0xff);
    expect(result.bytes).toBe(bytes.length);
    expect(result.rows).toBe(3);
  });

  it('round trip', async () => {
    const input = rows(25);
    expect(await readAll(encodeNdjsonGz(input))).toEqual(input);
  });

  it('a trailing newline ends the file', () => {
    const text = gunzipSync(encodeNdjsonGz(rows(2))).toString('utf8');
    expect(text).toBe(`${ndjsonLine(rows(2)[0] ?? {})}${ndjsonLine(rows(2)[1] ?? {})}`);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('reads a last line without a newline', async () => {
    const bytes = gzipSync('{"id":1,"name":"a"}\n{"id":2,"name":"b"}');
    expect(await readAll(bytes)).toEqual([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]);
  });

  it('a bad line names its number only', async () => {
    const secret = 'fixture-private-text';
    const bytes = gzipSync(
      `{"id":1,"name":"a"}\n{"id":2,"name":"b"}\n{"id":"x","name":"${secret}"}\n`,
    );
    let caught: unknown = null;
    try {
      await readAll(bytes);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NdjsonLineError);
    const message = caught instanceof Error ? caught.message : '';
    expect(message).toContain('line 3');
    expect(message).not.toContain(secret);
    expect(caught instanceof NdjsonLineError ? caught.lineNumber : 0).toBe(3);
  });

  it('a line that is not JSON names its number', async () => {
    await expect(readAll(gzipSync('{"id":1,"name":"a"}\nnot json\n'))).rejects.toThrow('line 2');
  });

  it('orderKeys refuses a missing key', () => {
    expect(() => orderKeys({ id: 1 } as Row, ['id', 'name'])).toThrow(/lacks the key name/);
    expect(() => orderKeys({ id: 1, name: 'a', extra: 1 } as Row, ['id', 'name'])).toThrow(/extra/);
    expect(Object.keys(orderKeys({ name: 'a', id: 1 }, ['id', 'name']))).toEqual(['id', 'name']);
  });

  it('streams a file larger than one chunk', async () => {
    const input = rows(200_000);
    const { bytes, result } = await writeAll(input);
    expect(result.rows).toBe(200_000);
    const back = await readAll(bytes);
    expect(back).toHaveLength(200_000);
    expect(back[199_999]).toEqual(input[199_999]);
  });
});

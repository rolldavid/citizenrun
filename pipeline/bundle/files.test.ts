import { gunzipSync } from 'node:zlib';
import { BJurisdictionSchema, BOfficeSchema } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { BundleRowInvalid, encodeFile } from './files.ts';
import { jurisdiction, office, proof } from './testing/rows.ts';

function lines(bytes: Uint8Array): string[] {
  return gunzipSync(bytes).toString('utf8').split('\n');
}

describe('encodeFile', () => {
  it('sorts rows given in reverse order by source_key in byte order', () => {
    const rows = [jurisdiction('census:a'), jurisdiction('census:B'), jurisdiction('census:A')];
    const out = encodeFile(rows, BJurisdictionSchema, 'jurisdictions');
    const keys = lines(out.bytes)
      .filter((line) => line !== '')
      .map((line) => (JSON.parse(line) as { source_key: string }).source_key);
    // Byte order: upper case before lower case, unlike locale order.
    expect(keys).toEqual(['census:A', 'census:B', 'census:a']);
    expect(out.rows).toBe(3);
  });

  it("writes keys in the schema's order and field_meta keys sorted, one line per row ending \\n", () => {
    const row = office('zz-office', {
      pay_annual_cents: 100,
      where_to_file: 'Fixture Office of Elections',
      field_meta: { where_to_file: proof(), pay_annual_cents: proof({ rule_citation: 'Code 1' }) },
    });
    const shuffled = Object.fromEntries(Object.entries(row).reverse()) as typeof row;
    const text = gunzipSync(encodeFile([shuffled], BOfficeSchema).bytes).toString('utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.split('\n')).toHaveLength(2);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(Object.keys(BOfficeSchema.shape));
    const meta = parsed['field_meta'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(meta)).toEqual(['pay_annual_cents', 'where_to_file']);
    expect(Object.keys(meta['pay_annual_cents'] ?? {})).toEqual([
      'source_url',
      'quote',
      'confidence',
      'checked_at',
      'rule_citation',
    ]);
    expect(text).not.toMatch(/": /);
  });

  it('writes a gzip header with mtime 0, the maximum compression flag and the fixed OS byte', () => {
    const { bytes } = encodeFile([jurisdiction('census:1')], BJurisdictionSchema);
    expect([...bytes.slice(0, 4)]).toEqual([0x1f, 0x8b, 0x08, 0x00]);
    expect([...bytes.slice(4, 10)]).toEqual([0x00, 0x00, 0x00, 0x00, 0x02, 0x03]);
  });

  it('gives equal bytes and hashes for two encodes of the same rows', () => {
    const rows = [jurisdiction('census:2'), jurisdiction('census:1')];
    const a = encodeFile(rows, BJurisdictionSchema);
    const b = encodeFile([...rows].reverse(), BJurisdictionSchema);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(a.sha256).toBe(b.sha256);
  });

  it('writes an empty file for no rows', () => {
    const out = encodeFile([], BJurisdictionSchema);
    expect(out.rows).toBe(0);
    expect(gunzipSync(out.bytes).toString('utf8')).toBe('');
  });

  it('throws BundleRowInvalid with the file and key for a row that fails its schema', () => {
    const bad = office('zz-bad', { seats: 0 });
    expect(() => encodeFile([bad], BOfficeSchema, 'offices')).toThrow(BundleRowInvalid);
    try {
      encodeFile([bad], BOfficeSchema, 'offices');
    } catch (error) {
      expect(error).toMatchObject({ file: 'offices', key: 'zz-bad' });
    }
  });
});

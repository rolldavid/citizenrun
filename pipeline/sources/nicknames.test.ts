import { describe, expect, it } from 'vitest';
import { createMemoryBucket } from '../testing/memory-bucket.ts';
import { saved, s09Context, scriptFetcher } from '../__fixtures__/s09/zz-s09.ts';
import {
  NicknamesUnpinnedError,
  buildGivenNameAliases,
  givenName,
  loadNicknames,
  pinnedCommit,
} from './nicknames.ts';

const NAME = /^[a-z][a-z' -]{0,40}$/;

async function excerpt() {
  const sample = await saved('names-excerpt.csv');
  return { bytes: sample.bytes, url: sample.meta.url };
}

describe('loadNicknames', () => {
  it('the excerpt gives has_nickname rows only, lower-cased and unaccented', async () => {
    const { bytes, url } = await excerpt();
    const bucket = createMemoryBucket();
    const fetcher = scriptFetcher(bucket, (req) =>
      req.url === url ? { body: bytes, contentType: 'text/plain; charset=utf-8' } : undefined,
    );
    const loaded = await loadNicknames(s09Context(bucket, fetcher), url, {
      supplement: () => Promise.resolve([]),
    });
    expect(loaded.commit).toBe(pinnedCommit(url));
    expect(loaded.key).toBe(`datasets/nicknames/${loaded.commit}/names.csv`);
    expect(fetcher.requests.map((r) => r.mode)).toEqual(['download']);
    const lines = Buffer.from(bytes).toString('utf8').trim().split(/\r?\n/).slice(1);
    const nicknameLines = lines.filter((line) => line.split(',')[1] === 'has_nickname');
    expect(loaded.rows).toHaveLength(new Set(nicknameLines.map((line) => line.toLowerCase())).size);
    expect(loaded.dropped).toBe(0);
    for (const row of loaded.rows) {
      expect(row.canonical).toMatch(NAME);
      expect(row.alias).toMatch(NAME);
      expect(row.source).toBe('nicknames');
      expect(row.source_key).toBe(`${row.canonical}|${row.alias}`);
    }
    expect(loaded.rows).toContainEqual({
      source_key: 'aaron|erin',
      canonical: 'aaron',
      alias: 'erin',
      source: 'nicknames',
    });
    const keys = loaded.rows.map((row) => row.source_key);
    expect(keys).toEqual([...keys].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
  });

  it('a url without a commit fails before any request', async () => {
    const bucket = createMemoryBucket();
    const fetcher = scriptFetcher(bucket, () => undefined);
    const ctx = s09Context(bucket, fetcher);
    for (const url of [
      'https://github.com/carltonnorthern/nicknames',
      'https://raw.githubusercontent.com/carltonnorthern/nicknames/master/names.csv',
      'https://raw.githubusercontent.com/carltonnorthern/nicknames/ed160b3/names.csv',
    ]) {
      await expect(loadNicknames(ctx, url)).rejects.toBeInstanceOf(NicknamesUnpinnedError);
    }
    expect(fetcher.requests).toHaveLength(0);
  });
});

describe('buildGivenNameAliases', () => {
  it('a supplement pair already in the file keeps the file row', () => {
    const { rows } = buildGivenNameAliases(
      [
        ['aaron', 'has_nickname', 'erin'],
        ['name1', 'relationship', 'name2'],
      ],
      [
        { canonical: 'aaron', alias: 'erin', note: 'Fixture note' },
        { canonical: 'jose', alias: 'pepe', note: 'Fixture note' },
      ],
    );
    expect(rows).toEqual([
      { source_key: 'aaron|erin', canonical: 'aaron', alias: 'erin', source: 'nicknames' },
      { source_key: 'jose|pepe', canonical: 'jose', alias: 'pepe', source: 'supplement' },
    ]);
  });

  it('removes accents, lower-cases, keeps has_nickname only and counts dropped rows', () => {
    const { rows, dropped } = buildGivenNameAliases(
      [
        ['José', 'has_nickname', 'Pepé'],
        ['zoe', 'is_nickname_of', 'zoey'],
        ['ab1', 'has_nickname', 'ab'],
        ['O’Neil', 'has_nickname', 'neil'],
      ],
      [],
    );
    expect(rows.map((row) => row.source_key)).toEqual(['jose|pepe']);
    expect(dropped).toBe(2);
    expect(givenName('  Mary   Ann ')).toBe('mary ann');
  });
});

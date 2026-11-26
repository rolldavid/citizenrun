import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createMemoryBucket } from '../testing/memory-bucket.ts';
import { bucketKeys } from './bucket.ts';
import {
  SlugRegistryError,
  assignSlugs,
  loadSlugRegistry,
  officeIdentity,
  saveSlugRegistry,
} from './slug.ts';

describe('officeIdentity', () => {
  it('joins the jurisdiction key, the template key or type and the district key', () => {
    expect(officeIdentity('census:123456', 'sheriff', 'tiger:county:37183')).toBe(
      'census:123456|sheriff|tiger:county:37183',
    );
  });
});

describe('assignSlugs', () => {
  it('the same identity gives the same slug on two runs', () => {
    const wanted = [{ identity: 'census:1|sheriff|d1', base: 'zz-fixture-county-sheriff' }];
    const first = assignSlugs(new Map(), wanted);
    const second = assignSlugs(first.registry, wanted);
    expect(first.assigned.get('census:1|sheriff|d1')).toBe('zz-fixture-county-sheriff');
    expect(second.assigned.get('census:1|sheriff|d1')).toBe('zz-fixture-county-sheriff');
    expect(second.registry).toEqual(first.registry);
  });

  it("a renamed jurisdiction keeps its office's slug", () => {
    const registry = new Map([['census:1|sheriff|d1', 'zz-fixture-county-sheriff']]);
    const result = assignSlugs(registry, [
      { identity: 'census:1|sheriff|d1', base: 'zz-renamed-fixture-county-sheriff' },
    ]);
    expect(result.assigned.get('census:1|sheriff|d1')).toBe('zz-fixture-county-sheriff');
    expect(result.failures).toEqual([]);
  });

  it('two identities with one base get -2 deterministically', () => {
    const a = { identity: 'census:1|x|d1', base: 'zz-x' };
    const b = { identity: 'census:2|x|d2', base: 'zz-x' };
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const result = assignSlugs(new Map(), order);
      expect(result.assigned.get('census:1|x|d1')).toBe('zz-x');
      expect(result.assigned.get('census:2|x|d2')).toBe('zz-x-2');
    }
  });

  it("a retired identity's slug is never reused", () => {
    const registry = new Map([['old|x|d', 'nc-x']]);
    const result = assignSlugs(registry, [{ identity: 'new|x|d', base: 'nc-x' }]);
    expect(result.assigned.get('new|x|d')).toBe('nc-x-2');
    expect(result.registry.get('old|x|d')).toBe('nc-x');
  });

  it('takes the smallest free suffix', () => {
    const registry = new Map([
      ['a', 'zz-x'],
      ['b', 'zz-x-3'],
    ]);
    const result = assignSlugs(registry, [
      { identity: 'c', base: 'zz-x' },
      { identity: 'd', base: 'zz-x' },
    ]);
    expect(result.assigned.get('c')).toBe('zz-x-2');
    expect(result.assigned.get('d')).toBe('zz-x-4');
  });

  it('a slug longer than 120 characters is a failure', () => {
    const base = `zz-${'a'.repeat(117)}`;
    expect(base.length).toBe(120);
    const result = assignSlugs(new Map([['held', base]]), [{ identity: 'new', base }]);
    expect(result.failures).toEqual(['new']);
    expect(result.assigned.has('new')).toBe(false);
    expect(result.registry.has('new')).toBe(false);
  });

  it('a base that fails SlugSchema is a failure', () => {
    const result = assignSlugs(new Map(), [{ identity: 'bad', base: 'Not A Slug' }]);
    expect(result.failures).toEqual(['bad']);
  });
});

describe('the registry in the bucket', () => {
  it('reads an absent registry as empty', async () => {
    const bucket = createMemoryBucket();
    expect((await loadSlugRegistry(bucket, 'offices')).size).toBe(0);
  });

  it('writes keys in byte order and reads them back', async () => {
    const bucket = createMemoryBucket();
    const registry = new Map([
      ['b|x|d', 'zz-b'],
      ['B|x|d', 'zz-upper-b'],
      ['a|x|d', 'zz-a'],
    ]);
    await saveSlugRegistry(bucket, 'people', registry);
    const bytes = await bucket.getBytes(bucketKeys.slugs('people'));
    expect(bytes).not.toBeNull();
    const text = gunzipSync(bytes ?? new Uint8Array()).toString('utf8');
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['B|x|d', 'a|x|d', 'b|x|d']);
    expect(await loadSlugRegistry(bucket, 'people')).toEqual(registry);
  });

  it('writes the same bytes for the same registry', async () => {
    const one = createMemoryBucket();
    const two = createMemoryBucket();
    const registry = new Map([['a|x|d', 'zz-a']]);
    await saveSlugRegistry(one, 'offices', registry);
    await saveSlugRegistry(two, 'offices', new Map(registry));
    expect(await one.getBytes(bucketKeys.slugs('offices'))).toEqual(
      await two.getBytes(bucketKeys.slugs('offices')),
    );
  });

  it('refuses a registry object that fails its schema', async () => {
    const bucket = createMemoryBucket();
    await bucket.putBytes(
      bucketKeys.slugs('offices'),
      new TextEncoder().encode('{}'),
      'application/gzip',
    );
    await expect(loadSlugRegistry(bucket, 'offices')).rejects.toThrow(SlugRegistryError);
  });
});

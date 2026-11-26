// The frozen slug registries (PIPE-slugs): an identity keeps its slug for ever, and a slug once
// given is never given to another identity, retired ones included.
import { gunzipSync, gzipSync } from 'node:zlib';
import { SlugSchema } from '@citizenrun/shared';
import { z } from 'zod';
import { bucketKeys } from './bucket.ts';
import type { DataBucket } from './bucket.ts';

/** Identity (or person key) to slug. */
export type SlugRegistry = ReadonlyMap<string, string>;
export type SlugKind = 'offices' | 'people';

/** The longest slug (02 offices_slug_check). */
const SLUG_MAX = 120;

const RegistryFileSchema = z.record(z.string().min(1).max(700), SlugSchema);

/** A registry object in the bucket that is not gzip JSON of identity to slug. */
export class SlugRegistryError extends Error {
  override readonly name = 'SlugRegistryError';
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Reads `pipeline-state/slugs/<kind>.json.gz`; an absent object is an empty registry. */
export async function loadSlugRegistry(bucket: DataBucket, kind: SlugKind): Promise<SlugRegistry> {
  const bytes = await bucket.getBytes(bucketKeys.slugs(kind));
  if (bytes === null) {
    return new Map();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(gunzipSync(bytes).toString('utf8'));
  } catch {
    throw new SlugRegistryError(`the ${kind} slug registry is not gzip JSON`);
  }
  const parsed = RegistryFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SlugRegistryError(`the ${kind} slug registry fails its schema`);
  }
  return new Map(Object.entries(parsed.data));
}

/** `<jurisdiction key>|<template office key or office type>|<district key>` */
export function officeIdentity(
  jurisdictionKey: string,
  templateKeyOrType: string,
  districtKey: string,
): string {
  return `${jurisdictionKey}|${templateKeyOrType}|${districtKey}`;
}

/**
 * Gives each wanted identity its slug. A registered identity keeps its slug. New identities are
 * taken in byte order of identity; each gets its base when no registry entry and no earlier
 * assignment holds it, else the base with the smallest free suffix `-2`, `-3`, ... A slug over 120
 * characters, or one that fails SlugSchema, is a failure and is not assigned.
 */
export function assignSlugs(
  registry: SlugRegistry,
  wanted: readonly { identity: string; base: string }[],
): { registry: SlugRegistry; assigned: ReadonlyMap<string, string>; failures: readonly string[] } {
  const next = new Map(registry);
  const taken = new Set(registry.values());
  const assigned = new Map<string, string>();
  const failures: string[] = [];
  const fresh = new Map<string, string>();
  for (const { identity, base } of wanted) {
    const known = registry.get(identity);
    if (known !== undefined) {
      assigned.set(identity, known);
    } else if (!fresh.has(identity)) {
      fresh.set(identity, base);
    }
  }
  for (const identity of [...fresh.keys()].sort(byteOrder)) {
    const base = fresh.get(identity) ?? '';
    let slug = base;
    for (let n = 2; taken.has(slug); n++) {
      slug = `${base}-${String(n)}`;
    }
    if (slug.length > SLUG_MAX || !SlugSchema.safeParse(slug).success) {
      failures.push(identity);
      continue;
    }
    taken.add(slug);
    next.set(identity, slug);
    assigned.set(identity, slug);
  }
  return { registry: next, assigned, failures };
}

/** Writes the registry as gzip JSON with its keys in byte order and a fixed gzip header. */
export async function saveSlugRegistry(
  bucket: DataBucket,
  kind: SlugKind,
  registry: SlugRegistry,
): Promise<void> {
  const ordered: Record<string, string> = {};
  for (const identity of [...registry.keys()].sort(byteOrder)) {
    ordered[identity] = registry.get(identity) ?? '';
  }
  const bytes = gzipSync(JSON.stringify(ordered), { level: 9 });
  // MTIME 0 and OS unknown, so the same registry always gives the same bytes.
  bytes.fill(0, 4, 8);
  bytes[9] = 0xff;
  await bucket.putBytes(
    bucketKeys.slugs(kind),
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    'application/gzip',
  );
}

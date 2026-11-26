import { uploads } from '@citizenrun/db';
import {
  buildPolicyForm,
  getTestObject,
  insertUpload,
  insertUser,
  listTestKeys,
  uploadWithPolicy,
} from '@citizenrun/db/testing';
import { MeSchema, UploadTicketSchema } from '@citizenrun/shared';
import type { UploadTicket } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth } from '../../testing/request.ts';

// TEST-upload-policy (D-248, CTL-05): the policy a ticket carries and the store's enforcement of
// it, on the worker's media test bucket.
const SECOND_MS = 1000;
const PHOTO_LIMIT = 8_388_608;
const POLICY_TTL_S = 300;
// A ticket signed while the process clock was 6 minutes behind is past its 300 seconds.
const STALE_MS = 360_000;

type PolicyDocument = { expiration: string; conditions: unknown[] };

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
});

afterEach(() => {
  vi.useRealTimers();
});

async function member(): Promise<{ user: { id: string }; auth: TestAuth }> {
  const user = await insertUser(testApp.deps.db);
  const auth = await signIn(testApp.deps.db, user, 'bearer');
  return { user, auth };
}

async function ticketFor(
  auth: TestAuth,
  contentType = 'image/jpeg',
  size = 1000,
): Promise<UploadTicket> {
  const response = await testApp.request.post('/v1/uploads', {
    auth,
    body: { kind: 'photo', purpose: 'avatar', contentType, size },
  });
  expect(response.status).toBe(201);
  return UploadTicketSchema.parse(await response.json());
}

function filledBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = (index * 7) % 256;
  }
  return bytes;
}

function policyOf(ticket: UploadTicket): PolicyDocument {
  const encoded = ticket.fields['Policy'];
  if (encoded === undefined) {
    throw new Error('The ticket carries no Policy field.');
  }
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as PolicyDocument; // the store's own JSON document
}

// X-Amz-Date is the signing instant in the form 20261126T101500Z.
function signingDateOf(ticket: UploadTicket): Date {
  const stamp = ticket.fields['X-Amz-Date'];
  if (stamp === undefined || !/^\d{8}T\d{6}Z$/.test(stamp)) {
    throw new Error('The ticket carries no X-Amz-Date field.');
  }
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13)}`;
  return new Date(iso);
}

function expectRefused(result: { status: number }): void {
  expect(result.status).toBeGreaterThanOrEqual(300);
}

function expectAccepted(result: { status: number }): void {
  expect(result.status).toBeGreaterThanOrEqual(200);
  expect(result.status).toBeLessThan(300);
}

async function uploadRow(id: string) {
  const [row] = await testApp.deps.db.select().from(uploads).where(eq(uploads.id, id));
  return row;
}

describe('TEST-upload-policy', () => {
  it('the upload form sends every policy field before the file', async () => {
    const { auth } = await member();
    const ticket = await ticketFor(auth, 'image/jpeg', 1000);
    const bytes = filledBytes(1000);
    const names = Object.keys(ticket.fields);
    expect(names).toEqual(
      expect.arrayContaining(['key', 'Policy', 'X-Amz-Signature', 'Content-Type']),
    );

    const form = buildPolicyForm(ticket, bytes, 'image/jpeg');
    expect([...form.keys()]).toEqual([...names, 'file']);
    const entries = [...form.entries()];
    for (const [name, value] of entries.slice(0, -1)) {
      expect(value).toBe(ticket.fields[name]);
    }
    const last = entries.at(-1);
    expect(last?.[0]).toBe('file');
    const file = last?.[1];
    if (!(file instanceof Blob)) {
      throw new Error('The last entry is not a file.');
    }
    expect(file.size).toBe(1000);
    expect(file.type).toBe('image/jpeg');
    expect(Buffer.from(await file.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);

    const png = buildPolicyForm(ticket, bytes, 'image/png');
    const pngNames = [...png.keys()];
    expect(pngNames).toEqual([...names, 'file']);
    expect(pngNames.indexOf('Content-Type')).toBe(names.indexOf('Content-Type'));
    expect(png.get('Content-Type')).toBe('image/png');
    expect(pngNames.at(-1)).toBe('file');
  });

  it('a ticket without a Content-Type field gets one after its fields', async () => {
    const { auth } = await member();
    const ticket = await ticketFor(auth);
    const rest = Object.fromEntries(
      Object.entries(ticket.fields).filter(([name]) => name !== 'Content-Type'),
    );
    const form = buildPolicyForm({ ...ticket, fields: rest }, filledBytes(10), 'image/jpeg');
    expect([...form.keys()]).toEqual([...Object.keys(rest), 'Content-Type', 'file']);
    expect(form.get('Content-Type')).toBe('image/jpeg');
  });

  it('limits by kind and platform', async () => {
    const { auth } = await member();
    const ticket = await ticketFor(auth, 'image/jpeg', PHOTO_LIMIT);
    expect(ticket.maxBytes).toBe(PHOTO_LIMIT);
    const over = await testApp.request.post('/v1/uploads', {
      auth,
      body: { kind: 'photo', purpose: 'avatar', contentType: 'image/jpeg', size: PHOTO_LIMIT + 1 },
    });
    expect(over.status).toBe(422);
    // A photo has the same limit from the web.
    const user = await insertUser(testApp.deps.db);
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    expect((await ticketFor(cookie, 'image/png', PHOTO_LIMIT)).maxBytes).toBe(PHOTO_LIMIT);
  });

  it('content types are allow-listed', async () => {
    const { auth } = await member();
    for (const contentType of ['image/jpeg', 'image/png', 'image/webp']) {
      const ticket = await ticketFor(auth, contentType);
      expect(ticket.fields['Content-Type']).toBe(contentType);
    }
    for (const contentType of [
      'image/svg+xml',
      'text/html',
      'image/heic',
      'application/octet-stream',
    ]) {
      const response = await testApp.request.post('/v1/uploads', {
        auth,
        body: { kind: 'photo', purpose: 'avatar', contentType, size: 1000 },
      });
      expect(response.status).toBe(400);
    }
  });

  it('the policy is exact', async () => {
    const { user, auth } = await member();
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
    for (const [contentType, extension] of Object.entries(extensions)) {
      const before = Date.now();
      const ticket = await ticketFor(auth, contentType, 1000);
      const after = Date.now();
      expect(ticket.key).toMatch(
        new RegExp(`^incoming/${user.id}/${ticket.uploadId}\\.(jpg|png|webp)$`),
      );
      expect(ticket.key.endsWith(`.${extension}`)).toBe(true);
      expect(ticket.fields['key']).toBe(ticket.key);

      const policy = policyOf(ticket);
      expect(policy.conditions).toContainEqual(['eq', '$Content-Type', contentType]);
      expect(policy.conditions).toContainEqual(['content-length-range', 1, PHOTO_LIMIT]);
      expect(policy.conditions).toContainEqual({ key: ticket.key });

      // The library signs with the process clock: the expiry is 300 seconds after signing. Both
      // instants are written to the second, and the client corrects its clock by the store's
      // whole-second Date header, so signing reads up to a second behind the process clock.
      const expiration = new Date(policy.expiration).getTime();
      expect(expiration - signingDateOf(ticket).getTime()).toBe(POLICY_TTL_S * SECOND_MS);
      expect(expiration).toBeGreaterThanOrEqual(before + (POLICY_TTL_S - 2) * SECOND_MS);
      expect(expiration).toBeLessThanOrEqual(after + (POLICY_TTL_S + 1) * SECOND_MS);
    }
  });

  it('the store enforces the policy', async () => {
    const { auth } = await member();
    const other = await member();

    // One byte over the signed range: a ticket for 1,000 bytes still allows up to the photo limit.
    const oversize = await ticketFor(auth, 'image/jpeg', 1000);
    expect(oversize.maxBytes).toBe(PHOTO_LIMIT);
    expectRefused(await uploadWithPolicy(oversize, filledBytes(PHOTO_LIMIT + 1), 'image/jpeg'));

    // Another content type than the one signed.
    const wrongType = await ticketFor(auth, 'image/jpeg', 1000);
    expectRefused(await uploadWithPolicy(wrongType, filledBytes(1000), 'image/png'));

    // Another user's key in place of the signed one.
    const theirs = await ticketFor(other.auth, 'image/jpeg', 1000);
    const mine = await ticketFor(auth, 'image/jpeg', 1000);
    const swapped: UploadTicket = { ...mine, fields: { ...mine.fields, key: theirs.key } };
    expectRefused(await uploadWithPolicy(swapped, filledBytes(1000), 'image/jpeg'));

    // A ticket signed while the process clock was 6 minutes behind has expired.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() - STALE_MS);
    let stale: UploadTicket;
    try {
      stale = await ticketFor(auth, 'image/jpeg', 1000);
    } finally {
      vi.useRealTimers();
    }
    expectRefused(await uploadWithPolicy(stale, filledBytes(1000), 'image/jpeg'));

    const keys = await listTestKeys('media', 'incoming/');
    for (const refused of [oversize, wrongType, theirs, mine, stale]) {
      expect(keys).not.toContain(refused.key);
      expect(await getTestObject('media', refused.key)).toBeNull();
    }

    // The right file under the right ticket.
    const right = await ticketFor(auth, 'image/jpeg', 1000);
    const bytes = filledBytes(1000);
    expectAccepted(await uploadWithPolicy(right, bytes, 'image/jpeg'));
    const stored = await getTestObject('media', right.key);
    expect(Buffer.from(stored ?? new Uint8Array()).equals(Buffer.from(bytes))).toBe(true);
    expect(await listTestKeys('media', 'incoming/')).toContain(right.key);
  });

  it('one owner, one use, one purpose', async () => {
    const { user, auth } = await member();
    const other = await member();
    const patch = (avatarUploadKey: string) =>
      testApp.request.patch('/v1/me', { auth, body: { avatarUploadKey } });
    const expectUploadInvalid = async (avatarUploadKey: string) => {
      const response = await patch(avatarUploadKey);
      expect(response.status).toBe(422);
      expect((await response.json<{ error: { code: string } }>()).error.code).toBe(
        'upload_invalid',
      );
    };

    const theirs = await ticketFor(other.auth);
    await expectUploadInvalid(theirs.key);
    expect((await uploadRow(theirs.uploadId))?.consumedAt).toBeNull();

    const consumed = await insertUpload(testApp.deps.db, {
      userId: user.id,
      consumedAt: new Date(testApp.deps.clock.now().getTime() - 60 * SECOND_MS),
    });
    await expectUploadInvalid(consumed.key);

    const forPost = await insertUpload(testApp.deps.db, { userId: user.id, purpose: 'post' });
    await expectUploadInvalid(forPost.key);
    expect((await uploadRow(forPost.id))?.consumedAt).toBeNull();

    const mine = await ticketFor(auth);
    const first = await patch(mine.key);
    expect(first.status).toBe(200);
    expect((await uploadRow(mine.uploadId))?.consumedAt).not.toBeNull();
    await expectUploadInvalid(mine.key);
  });

  it('no unprocessed key in a response', async () => {
    const { auth } = await member();
    const other = await member();
    const ticket = await ticketFor(auth);
    const attached = await testApp.request.patch('/v1/me', {
      auth,
      body: { avatarUploadKey: ticket.key },
    });
    expect(attached.status).toBe(200);
    expect(await attached.text()).not.toContain('incoming/');

    const own = await testApp.request.get('/v1/me', { auth });
    expect(own.status).toBe(200);
    const ownText = await own.text();
    expect(ownText).not.toContain('incoming/');
    expect(MeSchema.parse(JSON.parse(ownText)).avatarPending).toBe(true);

    const theirs = await testApp.request.get('/v1/me', { auth: other.auth });
    expect(theirs.status).toBe(200);
    expect(await theirs.text()).not.toContain('incoming/');
  });
});

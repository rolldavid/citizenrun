import type { EmailMessage, Mailer } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { jwtVerify } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { countedMailer, createIdentityKeys, enqueueOf, flagsOf } from './deps.ts';
import type { Deps } from './deps.ts';
import type { CapturedEmail } from './lib/mailer.ts';
import { createCaptureMailer, isCaptureMailer, toCapturedEmail } from './lib/mailer.ts';
import type { OutboundFetch } from './lib/outbound-fetch.ts';
import { FakeIdentityProviders } from './testing/fakes/identity.ts';
import { createFakeOutbound } from './testing/fakes/outbound.ts';
import { createUnitDeps } from './testing/unit-deps.ts';

function message(n: number): EmailMessage {
  return {
    to: 'person@example.test',
    subject: 'Fixture subject',
    text: `Fixture code ${String(n)}`,
    html: '<p>Fixture code</p>',
    idempotencyKey: `signin-fixture-${String(n)}`,
  };
}

// Unit deps with a queue of their own: createUnitDeps' queue throws on any read.
function unitDeps(): Deps {
  const enqueue: Deps['queue']['enqueue'] = () => Promise.resolve(null);
  return { ...createUnitDeps(), queue: { enqueue } };
}

describe('createIdentityKeys', () => {
  it('identity key sets are built without a request', () => {
    const spy = vi.fn<OutboundFetch>(() => Promise.resolve(new Response('{"keys":[]}')));
    const keys = createIdentityKeys(spy);
    expect(typeof keys.apple).toBe('function');
    expect(typeof keys.google).toBe('function');
    expect(spy).not.toHaveBeenCalled();
  });

  it('the remote key sets fetch through outbound', async () => {
    const outbound = createFakeOutbound();
    outbound.on('appleid.apple.com', 'GET', '/auth/keys', () => ({
      status: 200,
      json: { keys: [] },
    }));
    const keys = createIdentityKeys(outbound.fetch);
    // Signed with a key whose kid no published set holds.
    const token = await new FakeIdentityProviders(new FakeClock()).appleIdToken(
      {},
      { foreignKey: true },
    );
    await expect(jwtVerify(token, keys.apple)).rejects.toThrow();
    expect(outbound.calls.map(({ host, method, path }) => ({ host, method, path }))).toEqual([
      { host: 'appleid.apple.com', method: 'GET', path: '/auth/keys' },
    ]);
  });
});

describe('enqueueOf and flagsOf', () => {
  it('enqueueOf and flagsOf return one object per Deps', () => {
    const deps = unitDeps();
    const other = unitDeps();
    expect(enqueueOf(deps)).toBe(deps.queue.enqueue);
    const flags = flagsOf(deps);
    expect(flagsOf(deps)).toBe(flags);
    expect(flagsOf(other)).not.toBe(flags);
    expect(flagsOf(other)).toBe(flagsOf(other));
  });
});

describe('countedMailer', () => {
  it('the counted capture mailer still answers captured()', () => {
    const deps = createUnitDeps();
    const list: CapturedEmail[] = [];
    const inner: Mailer & { captured(): readonly CapturedEmail[] } = {
      sendEmail: (sent) => {
        list.push(toCapturedEmail(sent));
        return Promise.resolve();
      },
      captured: () => list,
    };
    list.push(toCapturedEmail(message(1)));
    const kept = countedMailer(inner, deps.db, deps.clock, deps.logger);
    expect(kept).not.toBe(inner);
    expect(isCaptureMailer(kept)).toBe(true);
    expect(isCaptureMailer(kept) ? kept.captured() : null).toEqual(list);

    const plain: Mailer = { sendEmail: () => Promise.resolve() };
    const counted = countedMailer(plain, deps.db, deps.clock, deps.logger);
    expect(isCaptureMailer(counted)).toBe(false);
  });

  it("the API capture mailer's captured() reads messages()", async () => {
    const mailer = createCaptureMailer();
    await mailer.sendEmail(message(1));
    await mailer.sendEmail(message(2));
    expect(isCaptureMailer(mailer)).toBe(true);
    expect(mailer.captured()).toEqual(mailer.messages());
    expect(mailer.captured().map((held) => held.idempotencyKey)).toEqual([
      'signin-fixture-1',
      'signin-fixture-2',
    ]);
    expect(mailer.captured()[0]?.to).toEqual(['person@example.test']);
  });
});

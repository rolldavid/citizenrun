import type { SessionInfo } from '@citizenrun/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureSessionInfo } from '@/lib/view-models/__fixtures__/common';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply } from '@/test/api-stub';

import { useEmailCodeFlow } from './use-email-code-flow';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

const EMAIL = 'fixture@example.test';
const PENDING = 'p'.repeat(43);
const START = {
  pendingToken: PENDING,
  expiresAt: '2027-01-15T12:10:00.000Z',
  resendAvailableAt: '2020-01-01T00:00:00.000Z',
};

let stub: ApiStub;
const onVerified = vi.fn<(info: SessionInfo) => void>();

function answerVerify(reply: StubReply): void {
  stub.use([
    { method: 'POST', path: '/v1/auth/email/start', reply: json(200, START) },
    { method: 'POST', path: '/v1/auth/email/verify', reply },
  ]);
}

function render(intent: 'reauth' | 'add_email') {
  return renderHook(() => useEmailCodeFlow({ intent, onVerified }));
}

type Flow = ReturnType<typeof render>;

async function toCode(hook: Flow): Promise<void> {
  act(() => {
    hook.result.current.open();
  });
  expect(hook.result.current.stage).toBe('email');
  act(() => {
    hook.result.current.sendTo(EMAIL);
  });
  await waitFor(() => {
    expect(hook.result.current.stage).toBe('code');
  });
}

function submit(hook: Flow): void {
  act(() => {
    hook.result.current.code?.onSubmit('123456');
  });
}

beforeEach(() => {
  stub = installApiStub([]);
  answerVerify(json(200, fixtureSessionInfo()));
  configureTestApiClient();
  onVerified.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useEmailCodeFlow', () => {
  it('adds an email', async () => {
    const answer = fixtureSessionInfo({ token: null });
    answerVerify(json(200, answer));
    const hook = render('add_email');
    expect(hook.result.current.stage).toBe('closed');
    await toCode(hook);
    expect(hook.result.current.code?.sentTo).toBe(EMAIL);
    submit(hook);
    await waitFor(() => {
      expect(onVerified).toHaveBeenCalledTimes(1);
    });

    expect(onVerified).toHaveBeenCalledWith(answer);
    expect(stub.requests.map((request) => [request.path, request.body])).toEqual([
      ['/v1/auth/email/start', { email: EMAIL }],
      ['/v1/auth/email/verify', { pendingToken: PENDING, code: '123456', intent: 'add_email' }],
    ]);
  });

  it('returns to the email when the address belongs to another account', async () => {
    answerVerify(apiError(409, 'email_in_use'));
    const hook = render('add_email');
    await toCode(hook);
    submit(hook);
    await waitFor(() => {
      expect(hook.result.current.stage).toBe('email');
    });
    expect(hook.result.current.email.errorCode).toBe('email_in_use');
    expect(hook.result.current.code).toBeNull();
    expect(hook.result.current.refusal).toBeNull();
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('reports an account that already has an email', async () => {
    answerVerify(apiError(409, 'email_already_set'));
    const hook = render('add_email');
    await toCode(hook);
    submit(hook);
    await waitFor(() => {
      expect(hook.result.current.refusal).toBe('email_already_set');
    });
    expect(hook.result.current.code?.status).toBe('idle');
  });

  it('reports a different account on re-authentication', async () => {
    answerVerify(apiError(409, 'reauth_mismatch'));
    const hook = render('reauth');
    await toCode(hook);
    submit(hook);
    await waitFor(() => {
      expect(hook.result.current.refusal).toBe('reauth_mismatch');
    });
    expect(hook.result.current.stage).toBe('email');
    expect(hook.result.current.code).toBeNull();
    expect(stub.requests.at(-1)?.body).toMatchObject({ intent: 'reauth' });
  });

  it('marks a wrong code', async () => {
    answerVerify(apiError(422, 'code_invalid'));
    const hook = render('reauth');
    await toCode(hook);
    submit(hook);
    await waitFor(() => {
      expect(hook.result.current.code?.status).toBe('wrong');
    });
    expect(hook.result.current.refusal).toBeNull();
  });

  it('forgets the address on close', async () => {
    const hook = render('add_email');
    await toCode(hook);
    act(() => {
      hook.result.current.close();
    });
    expect(hook.result.current.stage).toBe('closed');
    expect(hook.result.current.code).toBeNull();
    act(() => {
      hook.result.current.open();
    });
    expect(hook.result.current.stage).toBe('email');
    expect(hook.result.current.code).toBeNull();
    expect(hook.result.current.email).toMatchObject({ status: 'idle', errorCode: null });
  });
});

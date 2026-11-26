import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, RecordedRequest, StubReply } from '@/test/api-stub';
import { renderHookWithClient } from '@/test/render-hook';

import { useHandleCheck } from './use-handle-check';

let stub: ApiStub;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  stub = installApiStub([]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function answerByHandle(
  answers: Readonly<Record<string, 'available' | 'taken' | 'reserved'>>,
): (request: RecordedRequest) => StubReply {
  return (request) => {
    const handle = request.query['handle'] ?? '';
    const answer = answers[handle] ?? 'available';
    return json(200, {
      handle,
      available: answer === 'available',
      reason: answer === 'available' ? null : answer,
    });
  };
}

function checks(): RecordedRequest[] {
  return stub.requests.filter((request) => request.path === '/v1/handles/check');
}

/** Moves the fake clock and lets the answers that follow it arrive. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    for (let round = 0; round < 10; round += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
  });
}

describe('useHandleCheck', () => {
  it('waits 300 ms after the last keystroke', async () => {
    stub.use([{ method: 'GET', path: '/v1/handles/check', reply: answerByHandle({}) }]);
    const hook = renderHookWithClient(() => useHandleCheck({ ownHandle: null }));

    act(() => {
      hook.result.current.onChange('test_a');
    });
    await advance(100);
    act(() => {
      hook.result.current.onChange('test_ab');
    });
    await advance(100);
    act(() => {
      hook.result.current.onChange('test_abc');
    });
    expect(hook.result.current.check).toBe('checking');
    await advance(299);
    expect(checks()).toEqual([]);

    await advance(1);
    expect(checks().map((request) => request.query)).toEqual([{ handle: 'test_abc' }]);
    expect(hook.result.current).toMatchObject({
      check: 'free',
      invalidReason: null,
      handle: 'test_abc',
    });
  });

  it('drops an answer older than the newest request', async () => {
    stub.use([
      {
        method: 'GET',
        path: '/v1/handles/check',
        reply: answerByHandle({ test_one: 'taken', test_two: 'available' }),
      },
    ]);
    const stubbed = globalThis.fetch;
    const held: { release: () => void } = { release: () => undefined };
    let calls = 0;
    // The first answer arrives late and ignores the abort, as a slow network may
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls > 1) return stubbed(input, init);
      return new Promise<Response>((resolve) => {
        held.release = () => {
          resolve(stubbed(input, { ...init, signal: null }));
        };
      });
    });
    const hook = renderHookWithClient(() => useHandleCheck({ ownHandle: null }));

    act(() => {
      hook.result.current.onChange('test_one');
    });
    await advance(300);
    act(() => {
      hook.result.current.onChange('test_two');
    });
    await advance(300);
    expect(hook.result.current.check).toBe('free');

    act(() => {
      held.release();
    });
    await advance(0);

    expect(checks().map((request) => request.query['handle'])).toEqual(['test_two', 'test_one']);
    expect(hook.result.current).toMatchObject({ check: 'free', handle: 'test_two' });
  });

  it('makes no request for a value the device refuses', async () => {
    stub.use([{ method: 'GET', path: '/v1/handles/check', reply: answerByHandle({}) }]);
    const hook = renderHookWithClient(() => useHandleCheck({ ownHandle: null }));

    act(() => {
      hook.result.current.onChange('ab');
    });
    await advance(1000);
    expect(hook.result.current).toMatchObject({
      check: 'invalid',
      invalidReason: 'too_short',
      handle: null,
    });

    act(() => {
      hook.result.current.onChange('admin');
    });
    await advance(1000);
    expect(hook.result.current).toMatchObject({ check: 'reserved', invalidReason: null });
    expect(checks()).toEqual([]);
  });

  it("makes no request for the person's own handle", async () => {
    stub.use([{ method: 'GET', path: '/v1/handles/check', reply: answerByHandle({}) }]);
    const hook = renderHookWithClient(() => useHandleCheck({ ownHandle: 'test_fixture' }));

    act(() => {
      hook.result.current.onChange('test_fixture');
    });
    await advance(1000);

    expect(hook.result.current).toMatchObject({ check: 'free', handle: 'test_fixture' });
    expect(checks()).toEqual([]);
  });

  it('reports a failed check', async () => {
    stub.use([
      {
        method: 'GET',
        path: '/v1/handles/check',
        reply: (_request, index) =>
          index === 0 ? apiError(500, 'internal') : apiError(429, 'rate_limited'),
      },
    ]);
    const hook = renderHookWithClient(() => useHandleCheck({ ownHandle: null }));

    act(() => {
      hook.result.current.onChange('test_one');
    });
    await advance(300);
    expect(hook.result.current).toMatchObject({ check: 'failed', invalidReason: null });

    act(() => {
      hook.result.current.onChange('test_two');
    });
    expect(hook.result.current.check).toBe('checking');
    await advance(300);
    expect(hook.result.current).toMatchObject({ check: 'failed', handle: 'test_two' });
    expect(checks()).toHaveLength(2);
  });

  it('applies a state the caller sets', () => {
    const hook = renderHookWithClient(() => useHandleCheck({ ownHandle: null }));
    act(() => {
      hook.result.current.set({ check: 'taken', invalidReason: null });
    });
    expect(hook.result.current.check).toBe('taken');
  });

  it('aborts a pending check on unmount', async () => {
    stub.use([{ method: 'GET', path: '/v1/handles/check', reply: { kind: 'hang' } }]);
    const inFlight = renderHookWithClient(() => useHandleCheck({ ownHandle: null }));
    act(() => {
      inFlight.result.current.onChange('test_one');
    });
    await advance(300);
    expect(checks()).toHaveLength(1);
    const abort = vi.spyOn(AbortController.prototype, 'abort');

    inFlight.unmount();
    expect(abort).toHaveBeenCalledTimes(1);
    abort.mockRestore();

    const waiting = renderHookWithClient(() => useHandleCheck({ ownHandle: null }));
    act(() => {
      waiting.result.current.onChange('test_two');
    });
    waiting.unmount();
    await advance(1000);
    expect(checks()).toHaveLength(1);
  });
});

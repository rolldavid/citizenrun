import { useEffect, useRef, useState } from 'react';

import { checkHandle } from '../data/onboarding-requests';

import { HANDLE_CHECK_DELAY_MS, localHandleCheck, serverHandleCheck } from './handle-check';
import type { HandleCheckState } from './handle-check';

export type HandleChecker = HandleCheckState & {
  handle: string | null; // the last normalised value that passed the local check
  onChange: (value: string) => void; // the value C-HandleField already normalised as typed
  set: (state: HandleCheckState) => void;
};

const IDLE: HandleCheckState = { check: 'idle', invalidReason: null };
const FAILED: HandleCheckState = { check: 'failed', invalidReason: null };

/** The live handle check: the device's rules first, then E-ME-07 after a pause; late answers are dropped. */
export function useHandleCheck(options: { ownHandle: string | null }): HandleChecker {
  const [state, setState] = useState<HandleCheckState>(IDLE);
  const [handle, setCheckedHandle] = useState<string | null>(null);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      sequence.current += 1;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );

  const onChange = (value: string): void => {
    sequence.current += 1;
    const mine = sequence.current;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
    controller.current = null;

    const local = localHandleCheck(value, options.ownHandle);
    setState(local.state);
    setCheckedHandle(local.handle);
    const target = local.handle;
    if (!local.askServer || target === null) return;

    timer.current = setTimeout(() => {
      timer.current = null;
      const abort = new AbortController();
      controller.current = abort;
      void checkHandle(target, abort.signal).then((outcome) => {
        if (controller.current === abort) controller.current = null;
        if (mine !== sequence.current) return;
        if (outcome.ok) {
          setState(serverHandleCheck(outcome.value));
          return;
        }
        if (outcome.failure.kind === 'aborted') return;
        setState(FAILED);
      });
    }, HANDLE_CHECK_DELAY_MS);
  };

  const set = (next: HandleCheckState): void => {
    setState(next);
  };

  return { ...state, handle, onChange, set };
}

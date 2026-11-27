import type { ErrorCode, FieldReportInput } from '@citizenrun/shared';
import { createFieldReport } from '@citizenrun/shared/api';
import { useRef, useState } from 'react';

import { attempt, failureCode, useIsOnline } from '@/lib/view-models/query';

export type FieldReportState = {
  status: 'idle' | 'sending' | 'sent' | 'error';
  errorCode: ErrorCode | null;
  submit: (input: FieldReportInput) => void;
  reset: () => void;
};

type Status = Pick<FieldReportState, 'status' | 'errorCode'>;

const IDLE: Status = { status: 'idle', errorCode: null };

/**
 * E-OFF-09, not optimistic. The note and the link are passed through as given and kept nowhere:
 * not in a log, not on the device and not after the answer (the API checks the link and never
 * fetches it).
 */
export function useFieldReport(officeId: string | null): FieldReportState {
  const online = useIsOnline();
  const [state, setState] = useState<Status>(IDLE);
  // Each send and each reset takes a new number; an answer is shown only for the newest.
  const round = useRef(0);
  const sending = useRef(false);

  const submit = (input: FieldReportInput): void => {
    if (sending.current || officeId === null || !online) {
      return;
    }
    sending.current = true;
    round.current += 1;
    const mine = round.current;
    setState({ status: 'sending', errorCode: null });
    // An absent key is null to the API; the body goes as given, and nothing of it is kept here.
    const body = {
      field: input.field ?? null,
      message: input.message ?? null,
      sourceUrl: input.sourceUrl ?? null,
    };
    void attempt(() => createFieldReport(officeId, body)).then((outcome) => {
      if (mine !== round.current) {
        return;
      }
      sending.current = false;
      setState(
        outcome.ok
          ? { status: 'sent', errorCode: null }
          : { status: 'error', errorCode: failureCode(outcome.failure) },
      );
    });
  };

  const reset = (): void => {
    round.current += 1;
    sending.current = false;
    setState(IDLE);
  };

  return { status: state.status, errorCode: state.errorCode, submit, reset };
}

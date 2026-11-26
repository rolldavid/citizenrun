import type { ErrorCode } from '@citizenrun/shared';
import { useRef, useState } from 'react';

import { publicPageUrl } from '@/lib/navigation';
import { failureCode, useIsOnline } from '@/lib/view-models/query';
import { ageAssurance } from '@/platform/age-assurance';
import { queryClient } from '@/platform/query-client';

import { recordAgreements } from '../data/consents';
import { useMe } from '../data/me';

import type { AgreementsViewModel } from './agreements.types';

const NONE: AgreementsViewModel['needed'] = [];
const DELETE_HREF = '/settings/delete-account';

// D-350; PM-age-assurance
async function acknowledgeWhereRequired(): Promise<void> {
  try {
    if (await ageAssurance.significantUpdateAcknowledgmentRequired()) {
      await ageAssurance.acknowledgeSignificantUpdate();
    }
  } catch {
    // dropped
  }
}

/** SCR-system-agreements: E-ME-11 once per changed document; the sheet goes when the cached Me needs none. */
export function useAgreementsViewModel(): AgreementsViewModel {
  const { me } = useMe();
  const online = useIsOnline();
  const [status, setStatus] = useState<AgreementsViewModel['status']>('idle');
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);
  const saving = useRef(false);

  const needed = me?.consents.needed ?? NONE;

  const onAgree = (): void => {
    if (saving.current || me === null) return;
    if (!online) {
      setStatus('error');
      setErrorCode('unavailable');
      return;
    }
    saving.current = true;
    setStatus('saving');
    setErrorCode(null);
    void (async () => {
      await acknowledgeWhereRequired();
      const outcome = await recordAgreements(needed, me, queryClient.get());
      saving.current = false;
      if (outcome.ok) {
        setStatus('idle');
        setErrorCode(null);
      } else {
        setStatus('error');
        setErrorCode(failureCode(outcome.failure));
      }
    })();
  };

  return {
    needed,
    links: {
      terms: publicPageUrl('/terms'),
      contentPolicy: publicPageUrl('/content-policy'),
      privacyPolicy: publicPageUrl('/privacy'),
    },
    status,
    errorCode,
    onAgree,
    deleteHref: DELETE_HREF,
  };
}

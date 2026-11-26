import type { DataExportStatus, ErrorCode, Me } from '@citizenrun/shared';
import { useRef, useState } from 'react';

import { useReauth } from '@/features/auth';
import { useMe } from '@/features/system';
import { failureCode, useIsOnline, viewStateOf } from '@/lib/view-models/query';
import { links } from '@/platform/links';

import { exportDownload, requestExport, useExportStatus } from '../data/export-requests';

import type { SettingsExportViewModel } from './settings-export.types';

type ExportErrorCode = ErrorCode | 'generic' | null;

// D-536: a URL the API has just issued
async function openIssued(url: string): Promise<boolean> {
  try {
    return (await links.openIssuedUrl(url)) === 'opened';
  } catch {
    return false;
  }
}

/** SCR-settings-export: E-ME-05, E-ME-04 and E-ME-06 behind the re-authentication sheet. */
export function useSettingsExportViewModel(): SettingsExportViewModel {
  const exportStatus = useExportStatus();
  const { me, source: meSource } = useMe();
  const online = useIsOnline();
  const reauth = useReauth();
  const [requesting, setRequesting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [errorCode, setErrorCode] = useState<ExportErrorCode>(null);
  const requestBusy = useRef(false);
  const downloadBusy = useRef(false);
  const refetchStatus = exportStatus.refetch;
  const { openFor } = reauth;

  const doRequest = (): void => {
    if (requestBusy.current) return;
    requestBusy.current = true;
    setRequesting(true);
    setErrorCode(null);
    void requestExport().then((outcome) => {
      requestBusy.current = false;
      setRequesting(false);
      if (outcome.ok) {
        refetchStatus();
        return;
      }
      const code = failureCode(outcome.failure);
      if (code === 'recent_sign_in_required') {
        openFor(doRequest);
        return;
      }
      setErrorCode(code);
      if (code === 'daily_limit_reached') {
        refetchStatus();
      }
    });
  };

  const doDownload = (): void => {
    if (downloadBusy.current) return;
    downloadBusy.current = true;
    setDownloading(true);
    setErrorCode(null);
    void (async () => {
      const outcome = await exportDownload();
      if (outcome.ok) {
        if (!(await openIssued(outcome.value.url))) {
          setErrorCode('generic');
        }
      } else {
        const code = failureCode(outcome.failure);
        if (code === 'recent_sign_in_required') {
          openFor(doDownload);
        } else {
          setErrorCode(code);
          if (code === 'export_not_ready' || code === 'not_found') {
            refetchStatus();
          }
        }
      }
      downloadBusy.current = false;
      setDownloading(false);
    })();
  };

  const onRequest = (): void => {
    if (!online || requestBusy.current || me === null) return;
    reauth.run(me.session.sensitiveActionsUntil, doRequest);
  };

  const onDownload = (): void => {
    if (!online || downloadBusy.current || me === null) return;
    reauth.run(me.session.sensitiveActionsUntil, doDownload);
  };

  const view = viewStateOf<{ status: DataExportStatus; me: Me } | null>(
    [exportStatus.source, meSource],
    () =>
      exportStatus.status === null || me === null ? null : { status: exportStatus.status, me },
    online,
  );
  if (view.status !== 'ready') {
    return view;
  }
  if (view.data === null) {
    return { status: 'loading' };
  }
  return {
    ...view,
    data: {
      status: view.data.status,
      requesting,
      downloading,
      errorCode,
      reauth: reauth.vm,
      onRequest,
      onDownload,
    },
  };
}

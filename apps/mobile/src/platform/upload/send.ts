import type { UploadTicket } from '@citizenrun/shared';

import type { PreparedFile, SendOutcome, SendProgress } from './types';

// Sends one prepared file straight to the bucket under its ticket (PM-upload, D-248). One
// XMLHttpRequest on every platform, so upload progress is available everywhere. The ticket's URL,
// fields and key never reach a log, an error code or an outcome other than `sent`.

const NETWORK_FAILURE: SendOutcome = { kind: 'failed', code: 'upload.network' };

/** Headers the bucket never receives, whatever a ticket holds: no credential and no client header (lower case). */
const NEVER_SENT = new Set(['authorization', 'cookie', 'x-os-client']);

function outcomeOf(status: number, expiresAt: number, key: string): SendOutcome {
  if (status >= 200 && status <= 299) {
    return { kind: 'sent', key };
  }
  if (status === 403 && Date.now() >= expiresAt) {
    return { kind: 'expired' };
  }
  if (status >= 400 && status <= 499) {
    return { kind: 'refused', status };
  }
  // status 0, a 5xx, or anything else: the caller may try again while the ticket is unexpired
  return NETWORK_FAILURE;
}

/**
 * Sends `file` under `ticket`. `filePart` is the platform's FormData file value: `{ uri, name, type }`
 * on phones, a `Blob` on the web.
 */
export function sendWithXhr(
  file: PreparedFile,
  ticket: UploadTicket,
  filePart: unknown,
  opts: { onProgress: (p: SendProgress) => void; signal: AbortSignal },
): Promise<SendOutcome> {
  const expiresAt = Date.parse(ticket.expiresAt);
  if (Date.now() >= expiresAt) {
    return Promise.resolve({ kind: 'expired' });
  }
  if (file.size > ticket.maxBytes) {
    return Promise.resolve({ kind: 'refused', status: 413 });
  }
  const { signal, onProgress } = opts;
  if (signal.aborted) {
    return Promise.resolve({ kind: 'cancelled' });
  }

  return new Promise<SendOutcome>((resolve) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    function finish(outcome: SendOutcome): void {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    }

    function onAbort(): void {
      finish({ kind: 'cancelled' });
      xhr.abort();
    }

    xhr.upload.onprogress = (event: ProgressEvent) => {
      if (!settled) {
        onProgress({ sentBytes: event.loaded, totalBytes: event.total });
      }
    };
    xhr.onload = () => {
      finish(outcomeOf(xhr.status, expiresAt, ticket.key));
    };
    xhr.onerror = () => {
      finish(NETWORK_FAILURE);
    };
    xhr.ontimeout = () => {
      finish(NETWORK_FAILURE);
    };
    xhr.onabort = () => {
      finish({ kind: 'cancelled' });
    };
    signal.addEventListener('abort', onAbort);

    try {
      if (ticket.method === 'POST') {
        const form = new FormData();
        for (const [name, value] of Object.entries(ticket.fields)) {
          form.append(name, value);
        }
        // the file field last (D-248)
        form.append('file', filePart as Blob); // React Native's FormData also takes its { uri, name, type } file form, which the DOM typing does not declare
        xhr.open('POST', ticket.url);
        xhr.withCredentials = false;
        xhr.send(form);
      } else {
        xhr.open('PUT', ticket.url);
        xhr.withCredentials = false;
        for (const [name, value] of Object.entries(ticket.headers)) {
          if (!NEVER_SENT.has(name.toLowerCase())) {
            xhr.setRequestHeader(name, value);
          }
        }
        xhr.send(filePart as XMLHttpRequestBodyInit); // the platform's raw file part; its type is the caller's to choose
      }
    } catch {
      finish(NETWORK_FAILURE);
      xhr.abort();
    }
  });
}

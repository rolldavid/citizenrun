import type { UploadTicket } from '@citizenrun/shared';

/**
 * The multipart form a browser posts to a presigned POST policy: every policy field in the
 * ticket's order, the `Content-Type` field set to `contentType` (appended after them when the
 * ticket has none), then the file last (D-248). The store checks the policy's content-type
 * condition against that form field, not the file part's header.
 */
export function buildPolicyForm(
  ticket: UploadTicket,
  bytes: Uint8Array,
  contentType: string,
): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.fields)) {
    form.append(name, name === 'Content-Type' ? contentType : value);
  }
  if (!Object.hasOwn(ticket.fields, 'Content-Type')) {
    form.append('Content-Type', contentType);
  }
  // The copy gives the Uint8Array<ArrayBuffer> a BlobPart accepts, whatever buffer `bytes` sits on.
  form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), 'upload');
  return form;
}

/**
 * Posts buildPolicyForm's form to `ticket.url` with one fetch and reports the store's answer
 * (TEST-harness-storage); a refusal is a result, never a throw. No Content-Type header is set by
 * hand, so fetch writes the multipart boundary. No retry and no log line: the store's error body
 * can name the key.
 */
export async function uploadWithPolicy(
  ticket: UploadTicket,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(ticket.url, {
    method: 'POST',
    body: buildPolicyForm(ticket, bytes, contentType),
  });
  return { status: response.status, body: await response.text() };
}

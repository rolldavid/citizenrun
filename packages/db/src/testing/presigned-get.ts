/**
 * Fetches a presigned GET URL of the local store once and returns the status, the headers and the
 * body as bytes (TEST-harness-storage). For tests that may not call `fetch` themselves.
 */
export async function fetchPresignedGet(
  url: string,
): Promise<{ status: number; headers: Headers; body: Uint8Array }> {
  const response = await fetch(url);
  const body = new Uint8Array(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body };
}

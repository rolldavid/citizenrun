import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { getConfig } from 'expo/config';
import { z } from 'zod';

/** The app's own folder, where Expo finds the configuration the web export is built from. */
const MOBILE_DIR = resolve(import.meta.dirname, '../../..');
/** The API's OpenAPI document: the journeys take every path from it. */
const OPENAPI_FILE = resolve(MOBILE_DIR, '../api/openapi.json');

const OpenApiSchema = z.object({
  paths: z.record(z.string(), z.record(z.string(), z.object({ operationId: z.string() }).loose())),
});

let operations: Map<string, string> | null = null;

/** The path of an operation of the API's OpenAPI document, by its operation id. */
export function operationPath(operationId: string): string {
  if (operations === null) {
    const document = OpenApiSchema.parse(JSON.parse(readFileSync(OPENAPI_FILE, 'utf8')));
    operations = new Map(
      Object.entries(document.paths).flatMap(([path, methods]) =>
        Object.values(methods).map((operation) => [operation.operationId, path] as const),
      ),
    );
  }
  const path = operations.get(operationId);
  if (path === undefined) {
    throw new Error(`The OpenAPI document has no operation ${operationId}`);
  }
  return path;
}

let clientHeader: string | null = null;

/**
 * The `X-OS-Client` value the web build sends: `web/<version>` with the version of the app's
 * configuration (PM-session's web client info).
 */
function webClientHeader(): string {
  if (clientHeader === null) {
    const { version } = getConfig(MOBILE_DIR, { skipSDKVersionRequirement: true }).exp;
    clientHeader = version === undefined ? 'web' : `web/${version}`;
  }
  return clientHeader;
}

/** The origin the page was loaded from, or the project's base URL before its first navigation. */
function originOf(page: Page): string {
  const url = page.url();
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return new URL(url).origin;
  }
  const base = test.info().project.use.baseURL;
  if (base === undefined) {
    throw new Error('The project has no base URL');
  }
  return new URL(base).origin;
}

/**
 * The headers the web request mutator sends on a write: the client header and the `Origin` the
 * forgery check compares, so a request from a journey passes the same checks as the app's own.
 */
export function apiHeaders(page: Page): Promise<Record<string, string>> {
  return Promise.resolve({ 'X-OS-Client': webClientHeader(), Origin: originOf(page) });
}

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '../openapi.ts';
import type { OpenApiDocument } from '../openapi.ts';

/** Where the committed document lives: `apps/api/openapi.json`. */
export const OPENAPI_FILE = resolve(import.meta.dirname, '../../openapi.json');

/** The exact text of the committed file: two-space indentation and a trailing newline. */
export function serializeDocument(document: OpenApiDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Builds the document over the throwing dependencies and writes it; nothing starts or connects. */
export async function main(): Promise<void> {
  await writeFile(OPENAPI_FILE, serializeDocument(buildOpenApiDocument()), 'utf8');
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  await main();
}

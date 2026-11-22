import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The run's privacy marker: `PRIVMARK` and 12 lower-case hex characters. */
    privacyMarker: string;
  }
}

const MARKER_PATTERN = /^PRIVMARK[0-9a-f]{12}$/;

/** The run's privacy marker, which must never appear in a log line; throws when it is not provided. */
export function marker(): string {
  const value: unknown = inject('privacyMarker');
  if (typeof value !== 'string' || !MARKER_PATTERN.test(value)) {
    throw new Error('privacyMarker is not provided to this test project');
  }
  return value;
}
